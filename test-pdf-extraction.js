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

const USER_ID = 'a93f6858-95aa-4a13-8c09-558cf7177e7a';
const COURSE_ID = 1378023;
const CANVAS_TOKEN = process.env.CANVAS_TOKEN;

async function testPDFExtraction() {
    try {
        console.log('🔄 Starting PDF extraction test...\n');

        // 1. First, get Bias.pdf URL from Weaviate
        console.log('1. Getting Bias.pdf info:');
        const biasFileQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title content type metadata { filename size url } _additional { id }')  // Added _additional.id
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['courseId'], operator: 'Equal', valueNumber: COURSE_ID },
                    { path: ['title'], operator: 'Equal', valueString: 'Bias.pdf' }
                ]
            })
            .do();

        const biasFile = biasFileQuery.data?.Get?.CanvasContent?.[0];
        if (!biasFile?.metadata?.url) {
            throw new Error('Bias.pdf URL not found');
        }

        console.log('✅ Found Bias.pdf URL');
        console.log('- Title:', biasFile.title);
        console.log('- Size:', biasFile.metadata.size, 'bytes');
        console.log('- Current content preview:', biasFile.content.substring(0, 100) + '...\n');

        // 2. Extract content from PDF
        console.log('2. Extracting PDF content:');
        const pdfData = await FileProcessingService.processPDF(biasFile.metadata.url, {
            canvasToken: CANVAS_TOKEN
        });

        console.log('✅ Content extracted successfully');
        console.log('- Pages:', pdfData.metadata.pageCount);
        console.log('- Content preview:', pdfData.content.substring(0, 200) + '...\n');

        // 3. Update content in Weaviate
        console.log('3. Updating content in Weaviate:');
        const updateResult = await weaviateClient.data
            .updater()
            .withClassName('CanvasContent')
            .withId(biasFile._additional.id)
            .withProperties({
                content: pdfData.content
            })
            .do();

        console.log('✅ Content updated in Weaviate\n');

        // 4. Test semantic search
        console.log('4. Testing semantic search for "bias in machine learning":');
        const searchQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title content type _additional { distance }')
            .withNearText({
                concepts: ['What is bias in machine learning? How does bias affect model training and predictions?'],
            })
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['courseId'], operator: 'Equal', valueNumber: COURSE_ID }
                ]
            })
            .withLimit(5)  // Increased limit to see more results
            .do();

        const searchResults = searchQuery.data?.Get?.CanvasContent || [];
        console.log(`Found ${searchResults.length} relevant results:`);
        searchResults.forEach(result => {
            console.log(`\n- ${result.title} (${result.type})`);
            console.log('  Similarity:', (1 - result._additional.distance).toFixed(4));
            console.log('  Content preview:', result.content.substring(0, 200) + '...');
        });

    } catch (error) {
        console.error('❌ Error in test:', error);
    }
}

// Run the test
console.log('🚀 Starting test...\n');
testPDFExtraction(); 