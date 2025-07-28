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

async function deleteAllData() {
    try {
        console.log('🗑️ Deleting all existing data...');
        
        // Delete by userId
        await weaviateClient.batch.objectsBatchDeleter()
            .withClassName('CanvasContent')
            .withWhere({
                operator: 'Equal',
                path: ['userId'],
                valueString: 'a93f6858-95aa-4a13-8c09-558cf7177e7a'
            })
            .do();

        console.log('✅ All data deleted successfully');

    } catch (error) {
        console.error('❌ Error deleting data:', error);
    }
}

deleteAllData(); 