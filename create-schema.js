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

const schema = {
    class: "CanvasContent",
    description: "Canvas LMS content including assignments, announcements, and files",
    vectorizer: "text2vec-openai",
    moduleConfig: {
        "text2vec-openai": {
            model: "text-embedding-3-small",
            type: "text"
        }
    },
    properties: [
        {
            name: "content",
            dataType: ["text"],
            description: "The main content/description of the Canvas item",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "title",
            dataType: ["string"],
            description: "Title or name of the Canvas item",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "type",
            dataType: ["string"],
            description: "Type of content: assignment, announcement, file, page"
        },
        {
            name: "courseId",
            dataType: ["number"],
            description: "Canvas course ID"
        },
        {
            name: "userId",
            dataType: ["string"],
            description: "Supabase user ID"
        },
        {
            name: "canvasId",
            dataType: ["string"],
            description: "Original Canvas item ID"
        },
        {
            name: "filename",
            dataType: ["string"],
            description: "Original filename for file content"
        },
        {
            name: "size",
            dataType: ["number"],
            description: "File size in bytes"
        },
        {
            name: "contentType",
            dataType: ["string"],
            description: "MIME type of the file"
        },
        {
            name: "url",
            dataType: ["string"],
            description: "URL to access the file"
        }
    ]
};

async function recreateSchema() {
    try {
        // Delete existing schema
        console.log('🗑️ Deleting existing schema...');
        try {
            await weaviateClient.schema.classDeleter().withClassName('CanvasContent').do();
            console.log('✅ Existing schema deleted');
        } catch (error) {
            console.log('⚠️ No existing schema to delete');
        }

        // Create new schema
        console.log('🔄 Creating new schema...');
        await weaviateClient.schema.classCreator().withClass(schema).do();
        console.log('✅ Schema created successfully');
    } catch (error) {
        console.error('❌ Error recreating schema:', error);
    }
}

recreateSchema(); 