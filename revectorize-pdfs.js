import weaviate from 'weaviate-ts-client';
import { FileProcessingService } from './services/fileProcessing.js';
import dotenv from 'dotenv';

dotenv.config();

const weaviateClient = weaviate.client({
    scheme: 'https',
    host: process.env.WEAVIATE_URL.replace('https://', ''),
    apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    headers: {
        'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY,
    },
});

// Import the Canvas client from the build directory
import { CanvasClient } from './build/client.js';

const CANVAS_TOKEN = '1133~zauQ4cJeDNPVJmxRKh2HMDxPCkzQLx8mExLCZRB6c897FaP3W9M7n2CX8MCRC64m';
const canvasClient = new CanvasClient(CANVAS_TOKEN, 'umd.instructure.com');

const USER_ID = 'a93f6858-95aa-4a13-8c09-558cf7177e7a';
const COURSE_ID = 1378023;

async function revectorizePDFs() {
    try {
        console.log('🔄 Starting PDF re-vectorization...\n');

        // 1. Get all files from Canvas
        console.log('1. Getting files from Canvas:');
        const canvasFiles = await canvasClient.listFiles(COURSE_ID);
        const pdfs = canvasFiles.filter(file => file.filename.toLowerCase().endsWith('.pdf'));
        console.log(`Found ${pdfs.length} PDFs in Canvas\n`);

        // 2. Get files from Weaviate
        console.log('2. Getting files from Weaviate:');
        const weaviateQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title type canvasId _additional { id }')
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['courseId'], operator: 'Equal', valueNumber: COURSE_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'file' }
                ]
            })
            .do();

        const weaviateFiles = weaviateQuery.data?.Get?.CanvasContent || [];
        console.log(`Found ${weaviateFiles.length} files in Weaviate\n`);

        // 3. Process each PDF
        for (const pdf of pdfs) {
            try {
                console.log(`\nProcessing ${pdf.display_name}:`);

                // Find matching Weaviate file
                const weaviateFile = weaviateFiles.find(f => f.canvasId === pdf.id.toString());
                if (!weaviateFile) {
                    console.log('❌ File not found in Weaviate, skipping');
                    continue;
                }

                // Get fresh download URL from Canvas
                console.log('Getting fresh download URL...');
                const file = await canvasClient.getFile(pdf.id);
                const downloadUrl = file.url;
                console.log('Got fresh download URL');

                // Extract content
                const pdfData = await FileProcessingService.processPDF(downloadUrl, {
                    canvasToken: CANVAS_TOKEN
                });

                // Update in Weaviate
                await weaviateClient.data
                    .updater()
                    .withClassName('CanvasContent')
                    .withId(weaviateFile._additional.id)
                    .withProperties({
                        content: pdfData.content
                    })
                    .do();

                console.log('✅ Updated in Weaviate');

            } catch (error) {
                console.error(`❌ Error processing ${pdf.display_name}:`, error);
            }
        }

        console.log('\n✅ PDF re-vectorization completed');

    } catch (error) {
        console.error('❌ Error in re-vectorization:', error);
    }
}

// Run the script
console.log('🚀 Starting PDF re-vectorization...\n');
revectorizePDFs(); 