// =============================================
// CLARYFY WEAVIATE SCHEMA CONFIGURATION
// =============================================

// Canvas Content Schema - For assignments, announcements, files, etc.
export const CanvasContentSchema = {
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
            description: "Type of content: assignment, announcement, file, page",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "courseId",
            dataType: ["int"],
            description: "Canvas course ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "userId",
            dataType: ["string"],
            description: "Supabase user ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "canvasId",
            dataType: ["string"],
            description: "Original Canvas item ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "metadata",
            dataType: ["object"],
            description: "Additional metadata like due dates, points, file types",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "createdAt",
            dataType: ["date"],
            description: "When the content was created in Canvas",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        }
    ]
};

// Chat History Schema - For conversation context and search
export const ChatHistorySchema = {
    class: "ChatHistory",
    description: "Chat conversation history for context-aware responses",
    vectorizer: "text2vec-openai",
    moduleConfig: {
        "text2vec-openai": {
            model: "text-embedding-3-small",
            type: "text"
        }
    },
    properties: [
        {
            name: "message",
            dataType: ["text"],
            description: "User's message content",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "response",
            dataType: ["text"],
            description: "AI assistant's response",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "context",
            dataType: ["text"],
            description: "Additional context used for the response",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "courseId",
            dataType: ["int"],
            description: "Canvas course ID if chat was course-specific",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "userId",
            dataType: ["string"],
            description: "Supabase user ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "conversationId",
            dataType: ["string"],
            description: "Supabase conversation ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "timestamp",
            dataType: ["date"],
            description: "When the conversation occurred",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        }
    ]
};

// Recording Summary Schema - For lecture transcriptions and summaries
export const RecordingSummarySchema = {
    class: "RecordingSummary",
    description: "Recording transcriptions and AI-generated summaries",
    vectorizer: "text2vec-openai",
    moduleConfig: {
        "text2vec-openai": {
            model: "text-embedding-3-small",
            type: "text"
        }
    },
    properties: [
        {
            name: "summary",
            dataType: ["text"],
            description: "AI-generated summary of the recording",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "transcription",
            dataType: ["text"],
            description: "Full transcription from Whisper API",
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
            description: "Recording title or topic",
            moduleConfig: {
                "text2vec-openai": {
                    skip: false,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "courseId",
            dataType: ["int"],
            description: "Canvas course ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "userId",
            dataType: ["string"],
            description: "Supabase user ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "recordingId",
            dataType: ["string"],
            description: "Supabase recording ID",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "duration",
            dataType: ["int"],
            description: "Recording duration in seconds",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        },
        {
            name: "createdAt",
            dataType: ["date"],
            description: "When the recording was created",
            moduleConfig: {
                "text2vec-openai": {
                    skip: true,
                    vectorizePropertyName: false
                }
            }
        }
    ]
};

// Function to create all schemas in Weaviate
export async function createWeaviateSchemas(weaviateClient) {
    try {
        console.log('🔧 Creating Weaviate schemas...');

        // Check if schemas already exist
        const existingSchemas = await weaviateClient.schema.getter().do();
        const existingClassNames = existingSchemas.classes?.map(c => c.class) || [];

        // Create CanvasContent schema
        if (!existingClassNames.includes('CanvasContent')) {
            await weaviateClient.schema.classCreator().withClass(CanvasContentSchema).do();
            console.log('✅ CanvasContent schema created');
        } else {
            console.log('⚠️ CanvasContent schema already exists');
        }

        // Create ChatHistory schema  
        if (!existingClassNames.includes('ChatHistory')) {
            await weaviateClient.schema.classCreator().withClass(ChatHistorySchema).do();
            console.log('✅ ChatHistory schema created');
        } else {
            console.log('⚠️ ChatHistory schema already exists');
        }

        // Create RecordingSummary schema
        if (!existingClassNames.includes('RecordingSummary')) {
            await weaviateClient.schema.classCreator().withClass(RecordingSummarySchema).do();
            console.log('✅ RecordingSummary schema created');
        } else {
            console.log('⚠️ RecordingSummary schema already exists');
        }

        console.log('🎉 All Weaviate schemas ready!');
        return true;

    } catch (error) {
        console.error('❌ Error creating Weaviate schemas:', error);
        return false;
    }
}

// Function to delete all schemas (for development/testing)
export async function deleteWeaviateSchemas(weaviateClient) {
    try {
        console.log('🗑️ Deleting Weaviate schemas...');

        await weaviateClient.schema.classDeleter().withClassName('CanvasContent').do();
        await weaviateClient.schema.classDeleter().withClassName('ChatHistory').do();
        await weaviateClient.schema.classDeleter().withClassName('RecordingSummary').do();

        console.log('✅ All schemas deleted');
        return true;

    } catch (error) {
        console.error('❌ Error deleting schemas:', error);
        return false;
    }
}

// Sample search functions
export const searchQueries = {
    // Search Canvas content by topic
    searchCanvasContent: async (weaviateClient, query, userId, courseId = null, limit = 5) => {
        let whereFilter = {
            path: ['userId'],
            operator: 'Equal',
            valueString: userId
        };

        if (courseId) {
            whereFilter = {
                operator: 'And',
                operands: [
                    whereFilter,
                    {
                        path: ['courseId'],
                        operator: 'Equal',
                        valueInt: courseId
                    }
                ]
            };
        }

        return await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title content type courseId canvasId')
            .withNearText({ concepts: [query] })
            .withWhere(whereFilter)
            .withLimit(limit)
            .do();
    },

    // Search chat history for similar conversations
    searchChatHistory: async (weaviateClient, query, userId, courseId = null, limit = 3) => {
        let whereFilter = {
            path: ['userId'],
            operator: 'Equal',
            valueString: userId
        };

        if (courseId) {
            whereFilter = {
                operator: 'And',
                operands: [
                    whereFilter,
                    {
                        path: ['courseId'],
                        operator: 'Equal',
                        valueInt: courseId
                    }
                ]
            };
        }

        return await weaviateClient.graphql
            .get()
            .withClassName('ChatHistory')
            .withFields('message response context conversationId')
            .withNearText({ concepts: [query] })
            .withWhere(whereFilter)
            .withLimit(limit)
            .do();
    },

    // Search recording summaries
    searchRecordings: async (weaviateClient, query, userId, courseId = null, limit = 3) => {
        let whereFilter = {
            path: ['userId'],
            operator: 'Equal',
            valueString: userId
        };

        if (courseId) {
            whereFilter = {
                operator: 'And',
                operands: [
                    whereFilter,
                    {
                        path: ['courseId'],
                        operator: 'Equal',
                        valueInt: courseId
                    }
                ]
            };
        }

        return await weaviateClient.graphql
            .get()
            .withClassName('RecordingSummary')
            .withFields('title summary transcription recordingId duration')
            .withNearText({ concepts: [query] })
            .withWhere(whereFilter)
            .withLimit(limit)
            .do();
    }
}; 