import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function getEmbedding(text) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return response.data[0].embedding;
}

// Our search query
const searchQuery = "How does backpropagation work in neural networks? Explain the algorithm and gradient descent.";

getEmbedding(searchQuery)
    .then(vector => {
        console.log('Use this vector in your Weaviate query:');
        console.log(JSON.stringify(vector));
    })
    .catch(error => {
        console.error('Error:', error);
    }); 