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

// Test search term
const searchTerm = "neural network backpropagation gradient descent learning algorithm";

getEmbedding(searchTerm)
    .then(embedding => {
        console.log('Search vector:');
        console.log(JSON.stringify(embedding));
    })
    .catch(error => {
        console.error('Error:', error);
    }); 