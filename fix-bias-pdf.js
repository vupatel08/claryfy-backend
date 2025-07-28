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
const CANVAS_TOKEN = '1133~zauQ4cJeDNPVJmxRKh2HMDxPCkzQLx8mExLCZRB6c897FaP3W9M7n2CX8MCRC64m';
const CANVAS_DOMAIN = 'umd.instructure.com';

async function fixAllBiasPDFs() {
    try {
        // 1. Find all Bias.pdf objects in Weaviate
        console.log('🔍 Querying Weaviate for all Bias.pdf objects...');
        const query = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title content _additional { id }')
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['courseId'], operator: 'Equal', valueNumber: COURSE_ID },
                    { path: ['title'], operator: 'Equal', valueString: 'Bias.pdf' }
                ]
            })
            .do();
        const biasPDFs = query.data?.Get?.CanvasContent || [];
        if (biasPDFs.length === 0) {
            console.log('❌ No Bias.pdf objects found.');
            return;
        }
        biasPDFs.forEach((obj, idx) => {
            console.log(`\nBias.pdf object ${idx + 1}:`);
            console.log('ID:', obj._additional.id);
            console.log('Content preview:', obj.content.substring(0, 200));
        });

        // 2. Get fresh Bias.pdf content from Canvas
        console.log('\n🔍 Getting fresh Bias.pdf URL from Canvas...');
        const canvasClient = new CanvasClient(CANVAS_TOKEN, CANVAS_DOMAIN);
        const files = await canvasClient.listFiles(COURSE_ID);
        const biasFile = files.find(f => f.display_name === 'Bias.pdf' || f.filename === 'Bias.pdf');
        if (!biasFile) throw new Error('Bias.pdf not found in Canvas');
        const freshFile = await canvasClient.getFile(biasFile.id);
        const downloadUrl = freshFile.url;
        console.log('✅ Got fresh download URL:', downloadUrl);
        const pdfData = await FileProcessingService.processPDF(downloadUrl, {
            canvasToken: CANVAS_TOKEN
        });
        if (!pdfData.content || pdfData.content.trim().length === 0) throw new Error('No content extracted from Bias.pdf');
        console.log('✅ Extracted PDF content:', pdfData.content.substring(0, 200), '...');

        // 3. Update all Bias.pdf objects in Weaviate
        for (const obj of biasPDFs) {
            await weaviateClient.data
                .updater()
                .withClassName('CanvasContent')
                .withId(obj._additional.id)
                .withProperties({
                    content: pdfData.content
                })
                .do();
            console.log('✅ Updated Bias.pdf object:', obj._additional.id);
        }
        console.log('\n✅ All Bias.pdf objects updated with real content!');
    } catch (error) {
        console.error('❌ Error fixing Bias.pdf objects:', error);
    }
}

fixAllBiasPDFs(); 