import weaviate from 'weaviate-ts-client';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const weaviateClient = weaviate.client({
    scheme: 'https',
    host: process.env.WEAVIATE_URL.replace('https://', ''),
    apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    headers: {
        'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY,
    },
});

async function getEmbedding(text) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return response.data[0].embedding;
}

async function searchDocuments() {
    try {
        console.log('🔄 Getting embedding for search query...');
        const searchVector = await getEmbedding("How does backpropagation work in neural networks? Explain the algorithm and gradient descent.");

        console.log('🔍 Searching for documents...');
        const result = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('content title _additional { distance }')
            .withNearVector({
                vector: searchVector
            })
            .withLimit(5)
            .do();

        console.log('\n📄 Search Results:');
        const docs = result.data.Get.CanvasContent;
        docs.forEach((doc, i) => {
            console.log(`\nResult ${i + 1}:`);
            console.log('Title:', doc.title);
            console.log('Distance:', doc._additional.distance);
            console.log('Content:', doc.content.substring(0, 200) + '...');
        });

    } catch (error) {
        console.error('❌ Error searching documents:', error);
    }
}

searchDocuments(); 