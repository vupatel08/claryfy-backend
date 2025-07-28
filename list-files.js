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

async function listFiles() {
    try {
        console.log('🔍 Listing all files in Weaviate...\n');

        // Get all files for the user and course
        const query = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title type metadata { filename size url } _additional { id }')
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['courseId'], operator: 'Equal', valueNumber: COURSE_ID }
                ]
            })
            .do();

        const files = query.data?.Get?.CanvasContent || [];
        console.log(`Found ${files.length} items:`);
        files.forEach(file => {
            console.log(`\n- ${file.title} (${file.type})`);
            console.log('  ID:', file._additional.id);
            if (file.metadata) {
                console.log('  Size:', file.metadata.size, 'bytes');
                console.log('  URL:', file.metadata.url || 'N/A');
            }
        });

    } catch (error) {
        console.error('❌ Error listing files:', error);
    }
}

// Run the script
console.log('🚀 Starting file list...\n');
listFiles(); 