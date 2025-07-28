import weaviate from 'weaviate-ts-client';
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

async function cleanupBiasPDFs() {
    try {
        // Find all Bias.pdf objects
        console.log('🔍 Querying Weaviate for all Bias.pdf objects...');
        const query = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title _additional { id }')
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
            console.log('✅ No Bias.pdf objects found. Nothing to delete.');
            return;
        }
        for (const obj of biasPDFs) {
            await weaviateClient.data
                .deleter()
                .withClassName('CanvasContent')
                .withId(obj._additional.id)
                .do();
            console.log('🗑️ Deleted Bias.pdf object:', obj._additional.id);
        }
        console.log('✅ All Bias.pdf objects deleted!');
    } catch (error) {
        console.error('❌ Error cleaning up Bias.pdf objects:', error);
    }
}

cleanupBiasPDFs(); 