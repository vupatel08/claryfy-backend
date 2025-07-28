import weaviate from 'weaviate-ts-client';
import OpenAI from 'openai';
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

const testDocs = [
    {
        content: "Backpropagation is a method used in artificial neural networks to calculate the gradient of the loss function with respect to the weights of the network. This gradient is then used by the optimization method (usually gradient descent) to adjust the weights, enabling the network to learn from its errors.",
        title: "Backpropagation.pdf",
        type: "file",
        courseId: 1378023,
        userId: "a93f6858-95aa-4a13-8c09-558cf7177e7a",
        canvasId: "83052283",
        filename: "Backpropagation.pdf",
        size: 470395,
        contentType: "application/pdf"
    },
    {
        content: "Assignment: Neural Network Implementation. In this assignment, you will implement a neural network from scratch using Python. You will need to implement both forward propagation and backpropagation algorithms. The network should be able to learn XOR function and recognize handwritten digits from the MNIST dataset.",
        title: "Neural Network Implementation Assignment",
        type: "assignment",
        courseId: 1378023,
        userId: "a93f6858-95aa-4a13-8c09-558cf7177e7a",
        canvasId: "83052284",
        dueDate: "2024-04-15",
        points: 100
    },
    {
        content: "Important Announcement: Next week's lecture will focus on backpropagation and gradient descent algorithms. Please review the provided materials on neural network basics. We will implement these algorithms in Python and discuss how they enable neural networks to learn from training data.",
        title: "Next Week: Backpropagation Deep Dive",
        type: "announcement",
        courseId: 1378023,
        userId: "a93f6858-95aa-4a13-8c09-558cf7177e7a",
        canvasId: "83052285",
        postedAt: new Date().toISOString()
    }
];

async function addTestDocuments() {
    try {
        console.log('📝 Adding test documents...');

        for (const doc of testDocs) {
            const result = await weaviateClient.data
                .creator()
                .withClassName('CanvasContent')
                .withProperties(doc)
                .do();

            console.log(`✅ Added ${doc.type}: ${doc.title}`);
        }

        console.log('\n✅ All test documents added successfully');

    } catch (error) {
        console.error('❌ Error adding documents:', error);
    }
}

async function searchAllContentTypes() {
    try {
        const queries = [
            "How does backpropagation work?",
            "What is the neural network assignment about?",
            "When is the lecture on gradient descent?"
        ];

        for (const query of queries) {
            console.log(`\n🔍 Searching for: "${query}"`);

            const result = await weaviateClient.graphql
                .get()
                .withClassName('CanvasContent')
                .withFields('title content type _additional { distance }')
                .withNearText({
                    concepts: [query]
                })
                .withWhere({
                    operator: 'And',
                    operands: [
                        {
                            path: ['userId'],
                            operator: 'Equal',
                            valueString: 'a93f6858-95aa-4a13-8c09-558cf7177e7a'
                        },
                        {
                            path: ['courseId'],
                            operator: 'Equal',
                            valueNumber: 1378023
                        }
                    ]
                })
                .withLimit(3)
                .do();

            const docs = result.data.Get.CanvasContent;
            console.log('\nResults:');
            docs.forEach((doc, i) => {
                console.log(`\nMatch ${i + 1}:`);
                console.log('Type:', doc.type);
                console.log('Title:', doc.title);
                console.log('Similarity:', (1 - doc._additional.distance).toFixed(4));
                console.log('Content Preview:', doc.content.substring(0, 100) + '...');
            });
        }

    } catch (error) {
        console.error('❌ Error searching:', error);
    }
}

// Run the tests
async function runTests() {
    console.log('🔄 Starting All Content Types Test...\n');

    // First delete existing data
    console.log('🗑️ Deleting existing data...');
    await weaviateClient.batch.objectsBatchDeleter()
        .withClassName('CanvasContent')
        .withWhere({
            operator: 'Equal',
            path: ['userId'],
            valueString: 'a93f6858-95aa-4a13-8c09-558cf7177e7a'
        })
        .do();

    // Add test documents
    await addTestDocuments();

    // Test search
    await searchAllContentTypes();
}

runTests(); 