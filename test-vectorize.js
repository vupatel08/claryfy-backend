import { FileProcessingService } from './services/fileProcessing.js';
import weaviate from 'weaviate-ts-client';
import dotenv from 'dotenv';

dotenv.config();

const TEST_PDF_URL = "https://files.instructure.com/courses/1378023/files/83052283/download?download_frd=1";
const TEST_USER_ID = "a93f6858-95aa-4a13-8c09-558cf7177e7a";
const TEST_COURSE_ID = 1378023;

async function testPDFProcessing() {
    try {
        // Initialize Weaviate client
        const client = weaviate.client({
            scheme: 'https',
            host: process.env.WEAVIATE_URL.replace(/^https?:\/\//, ''),
            apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
            headers: {
                'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY,
            }
        });

        console.log('🔄 Starting PDF processing test...');

        // Process the PDF with Canvas auth
        console.log('📄 Processing PDF file...');
        const pdfData = await FileProcessingService.processPDF(TEST_PDF_URL, {
            headers: {
                'Authorization': `Bearer ${process.env.CANVAS_TOKEN}`
            }
        });

        if (!pdfData.content) {
            throw new Error('No content extracted from PDF');
        }

        console.log('📝 Content length:', pdfData.content.length);
        console.log('📄 First 200 characters:', pdfData.content.substring(0, 200));

        // Create Weaviate object
        const fileData = {
            content: pdfData.content,
            title: "Backpropagation.pdf",
            type: "file",
            courseId: TEST_COURSE_ID,
            userId: TEST_USER_ID,
            canvasId: "83052283",
            metadata: {
                filename: "Backpropagation.pdf",
                contentType: "application/pdf",
                size: 470395,
                url: TEST_PDF_URL,
                pageCount: pdfData.metadata.pageCount
            }
        };

        // Add to Weaviate
        console.log('📥 Adding to Weaviate...');
        const result = await client.data
            .creator()
            .withClassName('CanvasContent')
            .withProperties(fileData)
            .do();

        console.log('✅ Success! Object ID:', result.id);

        // Test retrieval
        console.log('🔍 Testing retrieval...');
        const query = await client.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('content title metadata { filename pageCount }')
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ["userId"], operator: "Equal", valueString: TEST_USER_ID },
                    { path: ["canvasId"], operator: "Equal", valueString: "83052283" }
                ]
            })
            .do();

        console.log('📄 Retrieved content:', query.data.Get.CanvasContent[0]);

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testPDFProcessing(); 