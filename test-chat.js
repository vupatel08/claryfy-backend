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

async function searchRelevantContent(query, userId, courseId) {
    const queryVector = await getEmbedding(query);

    const result = await weaviateClient.graphql
        .get()
        .withClassName('CanvasContent')
        .withFields('content title type _additional { distance }')
        .withNearVector({
            vector: queryVector
        })
        .withWhere({
            operator: 'And',
            operands: [
                {
                    path: ['userId'],
                    operator: 'Equal',
                    valueString: userId
                },
                {
                    path: ['courseId'],
                    operator: 'Equal',
                    valueNumber: courseId
                }
            ]
        })
        .withLimit(3)
        .do();

    return result.data.Get.CanvasContent;
}

async function simulateChatRequest() {
    try {
        const userId = 'a93f6858-95aa-4a13-8c09-558cf7177e7a';
        const courseId = 1378023;
        const userQuery = "Can you explain how backpropagation works in neural networks?";

        console.log('👤 User Query:', userQuery);
        console.log('\n🔍 Searching for relevant content...');

        const relevantDocs = await searchRelevantContent(userQuery, userId, courseId);

        console.log('\n📄 Found Relevant Documents:');
        relevantDocs.forEach((doc, i) => {
            console.log(`\nDocument ${i + 1}:`);
            console.log('Title:', doc.title);
            console.log('Type:', doc.type);
            console.log('Similarity Score:', 1 - doc._additional.distance);
            console.log('Content Preview:', doc.content.substring(0, 200) + '...');
        });

        // Simulate chat completion
        console.log('\n🤖 Generating AI Response...');
        const context = relevantDocs.map(doc => doc.content).join('\n\n');

        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful AI tutor. Use the provided context to answer the user\'s question accurately and concisely.'
                },
                {
                    role: 'user',
                    content: `Context:\n${context}\n\nQuestion: ${userQuery}`
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        });

        console.log('\n🤖 AI Response:');
        console.log(completion.choices[0].message.content);

    } catch (error) {
        console.error('❌ Error in chat simulation:', error);
    }
}

// Run the test
console.log('🔄 Starting Chat Interface Test...\n');
simulateChatRequest(); 