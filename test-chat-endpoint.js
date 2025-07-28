import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testChatEndpoint() {
    try {
        console.log('🔄 Testing chat endpoint...');

        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: "How does backpropagation work in neural networks?",
                userId: "a93f6858-95aa-4a13-8c09-558cf7177e7a",
                courseId: 1378023
            })
        });

        console.log('Response status:', response.status);

        const data = await response.json();
        console.log('\nResponse data:', JSON.stringify(data, null, 2));

    } catch (error) {
        console.error('❌ Error testing endpoint:', error);
    }
}

testChatEndpoint(); 