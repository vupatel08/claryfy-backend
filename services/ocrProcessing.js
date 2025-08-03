import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

export class OCRProcessingService {
    static async processImage(imageBuffer, options = {}) {
        let worker = null;
        try {
            console.log('🔍 Starting OCR processing...');
            
            // Initialize Tesseract worker
            worker = await createWorker(['eng']);
            
            // Configure OCR options
            await worker.setParameters({
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,!?;:()[]{}"\'-+=*/%@#$&~`^|\\<> \n\t',
                tessedit_pageseg_mode: '1', // Automatic page segmentation with OSD
                tessedit_ocr_engine_mode: '1' // LSTM only
            });

            // Preprocess image for better OCR results
            const processedBuffer = await this.preprocessImage(imageBuffer);

            // Perform OCR
            console.log('🔍 Performing OCR...');
            const { data: { text, confidence } } = await worker.recognize(processedBuffer);
            
            console.log(`✅ OCR completed with confidence: ${confidence}%`);
            console.log(`📄 Extracted text preview: ${text.substring(0, 200)}...`);

            return {
                text: text.trim(),
                confidence,
                metadata: {
                    engine: 'tesseract',
                    language: 'eng',
                    processingTime: Date.now()
                }
            };

        } catch (error) {
            console.error('❌ OCR processing failed:', error);
            throw new Error(`OCR processing failed: ${error.message}`);
        } finally {
            if (worker) {
                await worker.terminate();
            }
        }
    }

    static async preprocessImage(imageBuffer) {
        try {
            console.log('🔧 Preprocessing image for better OCR...');
            
            // Use Sharp to enhance the image for OCR
            const processedBuffer = await sharp(imageBuffer)
                .grayscale() // Convert to grayscale
                .normalize() // Normalize contrast
                .sharpen() // Sharpen edges
                .resize(null, 1000, { // Resize to optimal height for OCR
                    withoutEnlargement: true,
                    fit: 'inside'
                })
                .png({ quality: 100 }) // Convert to PNG for best OCR results
                .toBuffer();

            console.log('✅ Image preprocessing completed');
            return processedBuffer;

        } catch (error) {
            console.error('❌ Image preprocessing failed:', error);
            // Return original buffer if preprocessing fails
            return imageBuffer;
        }
    }

    static async processMultipleImages(imageBuffers, options = {}) {
        try {
            console.log(`🔍 Processing ${imageBuffers.length} images...`);
            
            const results = [];
            
            for (let i = 0; i < imageBuffers.length; i++) {
                console.log(`🔍 Processing image ${i + 1}/${imageBuffers.length}`);
                try {
                    const result = await this.processImage(imageBuffers[i], options);
                    results.push({
                        index: i,
                        success: true,
                        ...result
                    });
                } catch (error) {
                    console.error(`❌ Failed to process image ${i + 1}:`, error);
                    results.push({
                        index: i,
                        success: false,
                        error: error.message
                    });
                }
            }

            // Combine all extracted text
            const combinedText = results
                .filter(result => result.success)
                .map(result => result.text)
                .join('\n\n');

            const averageConfidence = results
                .filter(result => result.success)
                .reduce((sum, result) => sum + result.confidence, 0) / results.filter(result => result.success).length;

            return {
                text: combinedText,
                confidence: averageConfidence || 0,
                results,
                metadata: {
                    totalImages: imageBuffers.length,
                    successfulImages: results.filter(r => r.success).length,
                    failedImages: results.filter(r => !r.success).length
                }
            };

        } catch (error) {
            console.error('❌ Multiple image OCR processing failed:', error);
            throw error;
        }
    }

    static isImageFile(contentType) {
        const imageTypes = [
            'image/jpeg',
            'image/jpg', 
            'image/png',
            'image/gif',
            'image/bmp',
            'image/webp',
            'image/tiff',
            'image/tif'
        ];
        return imageTypes.includes(contentType?.toLowerCase());
    }

    static async extractTextFromFile(fileBuffer, contentType, fileName) {
        try {
            console.log(`🔍 Extracting text from file: ${fileName} (${contentType})`);

            if (this.isImageFile(contentType)) {
                return await this.processImage(fileBuffer);
            } else if (contentType === 'application/pdf') {
                // For PDFs, we'll use the existing PDF processing service
                // This method is called when we specifically want OCR from PDF images
                console.log('📄 PDF file detected - delegating to PDF processor');
                return {
                    text: '',
                    confidence: 0,
                    metadata: {
                        note: 'PDF processing delegated to FileProcessingService'
                    }
                };
            } else {
                throw new Error(`Unsupported file type for OCR: ${contentType}`);
            }

        } catch (error) {
            console.error('❌ File text extraction failed:', error);
            throw error;
        }
    }
}

export default OCRProcessingService;
