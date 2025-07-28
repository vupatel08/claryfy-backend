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

const testDoc = {
    content: "Backpropagation is a method used in artificial neural networks to calculate the gradient of the loss function with respect to the weights of the network. This gradient is then used by the optimization method (usually gradient descent) to adjust the weights, enabling the network to learn from its errors. The process involves computing the gradient layer by layer, starting from the output and moving backwards through the network.",
    title: "Backpropagation.pdf",
    type: "file",
    courseId: 1378023,
    userId: "a93f6858-95aa-4a13-8c09-558cf7177e7a",
    canvasId: "83052283",
    filename: "Backpropagation.pdf",
    size: 470395,
    contentType: "application/pdf"
};

async function addTestDocument() {
    try {
        console.log('📝 Adding test document...');
        const result = await weaviateClient.data
            .creator()
            .withClassName('CanvasContent')
            .withProperties(testDoc)
            .do();

        console.log('✅ Document added successfully');
        console.log('Document ID:', result.id);

        // Fetch the document with its vector
        console.log('\n🔍 Fetching document with vector...');
        const docWithVector = await weaviateClient.data
            .getterById()
            .withClassName('CanvasContent')
            .withId(result.id)
            .withVector()
            .do();

        console.log('Document vector length:', docWithVector.vector?.length);
        console.log('First few vector components:', docWithVector.vector?.slice(0, 5));

    } catch (error) {
        console.error('❌ Error adding document:', error);
    }
}

addTestDocument(); 