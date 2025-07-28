import weaviate from 'weaviate-ts-client';
import { FileProcessingService } from './services/fileProcessing.js';
import { CanvasClient } from './build/client.js';
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

const USER_ID = 'a93f6858-95aa-4a13-8c09-558cf7177e7a';
const COURSE_ID = 1378023;
const BIAS_FILE_ID = 'b6b4d6e3-f827-4fc0-b113-225aa04a14e3';
const CANVAS_TOKEN = '1133~zauQ4cJeDNPVJmxRKh2HMDxPCkzQLx8mExLCZRB6c897FaP3W9M7n2CX8MCRC64m';
const CANVAS_DOMAIN = 'umd.instructure.com';

async function injectBiasPDFContent() {
    try {
        console.log('🔍 Getting fresh Bias.pdf URL from Canvas...');
        const canvasClient = new CanvasClient(CANVAS_TOKEN, CANVAS_DOMAIN);
        // Find Bias.pdf file ID from Canvas
        const files = await canvasClient.listFiles(COURSE_ID);
        const biasFile = files.find(f => f.display_name === 'Bias.pdf' || f.filename === 'Bias.pdf');
        if (!biasFile) throw new Error('Bias.pdf not found in Canvas');
        const freshFile = await canvasClient.getFile(biasFile.id);
        const downloadUrl = freshFile.url;
        console.log('✅ Got fresh download URL:', downloadUrl);

        // Extract PDF content
        const pdfData = await FileProcessingService.processPDF(downloadUrl, {
            canvasToken: CANVAS_TOKEN
        });
        if (!pdfData.content || pdfData.content.trim().length === 0) throw new Error('No content extracted from Bias.pdf');
        console.log('✅ Extracted PDF content:', pdfData.content.substring(0, 200), '...');

        // Update Weaviate object
        await weaviateClient.data
            .updater()
            .withClassName('CanvasContent')
            .withId(BIAS_FILE_ID)
            .withProperties({
                content: pdfData.content
            })
            .do();
        console.log('✅ Injected real content into Bias.pdf in Weaviate');
    } catch (error) {
        console.error('❌ Error injecting Bias.pdf content:', error);
    }
}

// Run the injection
injectBiasPDFContent(); 