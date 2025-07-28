import pdfParse from 'pdf-parse';
import fetch from 'node-fetch';

export class FileProcessingService {
    static async processPDF(url, options = {}) {
        try {
            console.log('📄 Downloading PDF from:', url);

            // For Canvas URLs, we need to:
            // 1. Get the actual download URL (which includes the verifier)
            // 2. Then download the file with the Canvas token
            let downloadUrl = url;
            if (url.includes('instructure.com')) {
                const canvasResponse = await fetch(url, {
                    headers: options.canvasToken ? {
                        'Authorization': `Bearer ${options.canvasToken}`
                    } : {}
                });
                if (!canvasResponse.ok) {
                    throw new Error(`Failed to get Canvas file: ${canvasResponse.statusText}`);
                }
                // Canvas redirects to the actual file URL
                downloadUrl = canvasResponse.url;
            }

            // Now download the actual file
            const fileResponse = await fetch(downloadUrl);
            if (!fileResponse.ok) {
                throw new Error(`Failed to download PDF: ${fileResponse.statusText}`);
            }

            const buffer = await fileResponse.arrayBuffer();
            console.log('📄 Parsing PDF content...');

            const data = await pdfParse(Buffer.from(buffer));
            console.log('✅ PDF content extracted successfully');
            console.log('Pages:', data.numpages);
            console.log('Content preview:', data.text.substring(0, 100) + '...');

            return {
                content: data.text,
                metadata: {
                    pageCount: data.numpages,
                    info: data.info
                }
            };
        } catch (error) {
            console.error('❌ Error processing PDF:', error);
            throw error;
        }
    }
} 