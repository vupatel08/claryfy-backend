// =============================================
// CLARYFY WEAVIATE SERVICE
// =============================================

import weaviate, { ApiKey } from 'weaviate-ts-client';
import * as dotenv from 'dotenv';
import { createWeaviateSchemas, searchQueries } from '../weaviate-schema.js';
import axios from 'axios';
import pdfParse from 'pdf-parse';

dotenv.config();

// Initialize Weaviate client
const weaviateUrl = process.env.WEAVIATE_URL;
const weaviateApiKey = process.env.WEAVIATE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!weaviateUrl || !weaviateApiKey) {
    console.log('⚠️ Weaviate configuration missing. Vector search features will be disabled.');
    console.log('   Set WEAVIATE_URL and WEAVIATE_API_KEY environment variables to enable vector search.');
}

export const weaviateClient = weaviate.client({
    scheme: 'https',
    host: weaviateUrl.replace('https://', ''),
    apiKey: new ApiKey(weaviateApiKey),
    headers: {
        'X-OpenAI-Api-Key': openaiApiKey,
    },
});

// =============================================
// WEAVIATE MANAGEMENT SERVICE
// =============================================

export class WeaviateManagementService {

    // Initialize schemas
    static async initializeSchemas() {
        try {
            console.log('🔧 Initializing Weaviate schemas...');
            const success = await createWeaviateSchemas(weaviateClient);
            if (success) {
                console.log('✅ Weaviate schemas initialized successfully');
            }
            return success;
        } catch (error) {
            console.error('❌ Error initializing Weaviate schemas:', error);
            return false;
        }
    }

    // Health check
    static async healthCheck() {
        try {
            const response = await weaviateClient.misc.liveChecker().do();
            return {
                status: 'ok',
                timestamp: new Date().toISOString(),
                weaviate: response
            };
        } catch (error) {
            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    // Get schema info
    static async getSchemaInfo() {
        try {
            const schema = await weaviateClient.schema.getter().do();
            return {
                classes: schema.classes?.map(c => ({
                    name: c.class,
                    description: c.description,
                    properties: c.properties?.length || 0
                })) || []
            };
        } catch (error) {
            console.error('Error getting schema info:', error);
            throw error;
        }
    }
}

// =============================================
// CANVAS CONTENT VECTORIZATION SERVICE
// =============================================

export class WeaviateCanvasService {

    // Vectorize Canvas assignments
    static async vectorizeAssignments(userId, assignments) {
        try {
            console.log(`📝 Vectorizing ${assignments.length} assignments...`);

            // Prepare all assignment data in parallel
            const assignmentData = assignments.map(assignment => ({
                content: assignment.description || assignment.name,
                title: assignment.name,
                type: 'assignment',
                courseId: assignment.course_id,
                userId: userId,
                canvasId: assignment.id.toString(),
                metadata: {
                    dueDate: assignment.due_at,
                    points: assignment.points_possible,
                    submissionTypes: assignment.submission_types
                },
                createdAt: assignment.created_at
            }));

            // Use batch operation for faster vectorization
            const results = await this.batchCreateObjects('CanvasContent', assignmentData);

            console.log(`✅ Vectorized ${results.length}/${assignments.length} assignments`);
            return results;
        } catch (error) {
            console.error('Error vectorizing assignments:', error);
            throw error;
        }
    }

    // Vectorize Canvas announcements
    static async vectorizeAnnouncements(userId, announcements) {
        try {
            console.log(`📢 Vectorizing ${announcements.length} announcements...`);

            // Prepare all announcement data in parallel
            const announcementData = announcements.map(announcement => ({
                content: announcement.message || announcement.title,
                title: announcement.title,
                type: 'announcement',
                courseId: announcement.course_id,
                userId: userId,
                canvasId: announcement.id.toString(),
                metadata: {
                    author: announcement.author,
                    postedAt: announcement.posted_at
                },
                createdAt: announcement.created_at
            }));

            // Use batch operation for faster vectorization
            const results = await this.batchCreateObjects('CanvasContent', announcementData);

            console.log(`✅ Vectorized ${results.length}/${announcements.length} announcements`);
            return results;
        } catch (error) {
            console.error('Error vectorizing announcements:', error);
            throw error;
        }
    }

    // Vectorize Canvas files
    static async vectorizeFiles(userId, files) {
        try {
            console.log(`📁 Vectorizing ${files.length} files...`);

            // Prepare all file data in parallel
            const fileData = await Promise.all(files.map(async (file) => {
                let content = `${file.display_name} ${file.filename || ''} ${file.description || ''}`.trim();

                // If the file is a PDF, try to download and parse it
                if (file.content_type === 'application/pdf' && file.url) {
                    try {
                        const response = await axios.get(file.url, { responseType: 'arraybuffer' });
                        const pdfBuffer = Buffer.from(response.data);
                        const pdfData = await pdfParse(pdfBuffer);
                        if (pdfData.text) {
                            content = pdfData.text.substring(0, 20000); // Limit to 20k chars for safety
                        }
                    } catch (err) {
                        console.error(`Error parsing PDF for file ${file.display_name}:`, err.message);
                    }
                }

                // Debug log: print first 200 chars of content
                console.log(`File: ${file.display_name} | Content Preview:`, content.substring(0, 200));

                return {
                    content: content,
                    title: file.display_name,
                    type: 'file',
                    courseId: file.course_id,
                    userId: userId,
                    canvasId: file.id.toString(),
                    metadata: {
                        filename: file.filename,
                        contentType: file.content_type,
                        size: file.size,
                        url: file.url
                    },
                    createdAt: file.created_at
                };
            }));

            // Use batch operation for faster vectorization
            const results = await this.batchCreateObjects('CanvasContent', fileData);

            console.log(`✅ Vectorized ${results.length}/${files.length} files`);
            return results;
        } catch (error) {
            console.error('Error vectorizing files:', error);
            throw error;
        }
    }

    // Vectorize all Canvas data for a user (now with parallel processing)
    static async vectorizeAllCanvasData(userId, canvasData) {
        try {
            console.log('🚀 Starting full Canvas data vectorization...');

            // Clear existing data for user first
            await this.clearUserData(userId);

            // Process all types in parallel for maximum speed
            const vectorizationPromises = [];

            if (canvasData.assignments && canvasData.assignments.length > 0) {
                vectorizationPromises.push(
                    this.vectorizeAssignments(userId, canvasData.assignments)
                        .then(results => ({ type: 'assignments', results }))
                );
            }

            if (canvasData.announcements && canvasData.announcements.length > 0) {
                vectorizationPromises.push(
                    this.vectorizeAnnouncements(userId, canvasData.announcements)
                        .then(results => ({ type: 'announcements', results }))
                );
            }

            if (canvasData.files && canvasData.files.length > 0) {
                vectorizationPromises.push(
                    this.vectorizeFiles(userId, canvasData.files)
                        .then(results => ({ type: 'files', results }))
                );
            }

            // Wait for all vectorization to complete in parallel
            const completedResults = await Promise.all(vectorizationPromises);

            // Organize results
            const results = {
                assignments: [],
                announcements: [],
                files: []
            };

            completedResults.forEach(({ type, results: typeResults }) => {
                results[type] = typeResults;
            });

            const totalVectorized = results.assignments.length + results.announcements.length + results.files.length;
            console.log(`🎉 Canvas vectorization complete! Total items: ${totalVectorized}`);

            return results;
        } catch (error) {
            console.error('Error in full Canvas vectorization:', error);
            throw error;
        }
    }

    // Clear user's Canvas data
    static async clearUserData(userId) {
        try {
            console.log(`🗑️ Clearing existing Canvas data for user ${userId}...`);

            await weaviateClient.batch.objectsBatchDeleter()
                .withClassName('CanvasContent')
                .withWhere({
                    path: ['userId'],
                    operator: 'Equal',
                    valueString: userId
                })
                .do();

            console.log('✅ Existing Canvas data cleared');
        } catch (error) {
            console.error('Error clearing user data:', error);
            // Don't throw - this is not critical
        }
    }

    // Optimized batch creation method
    static async batchCreateObjects(className, objects) {
        try {
            if (!objects || objects.length === 0) return [];

            console.log(`📦 Batch creating ${objects.length} objects in ${className}...`);

            // Process in chunks for very large datasets
            const CHUNK_SIZE = 100; // Weaviate batch limit
            const results = [];

            for (let i = 0; i < objects.length; i += CHUNK_SIZE) {
                const chunk = objects.slice(i, i + CHUNK_SIZE);

                const batcher = weaviateClient.batch.objectsBatcher();

                chunk.forEach(obj => {
                    batcher.withObject({
                        class: className,
                        properties: obj
                    });
                });

                const batchResult = await batcher.do();

                if (batchResult && batchResult.length > 0) {
                    results.push(...batchResult);
                }
            }

            console.log(`✅ Batch created ${results.length} objects`);
            return results;
        } catch (error) {
            console.error('Error in batch creation:', error);
            throw error;
        }
    }
}

// =============================================
// CHAT HISTORY VECTORIZATION SERVICE
// =============================================

export class WeaviateChatService {

    // Vectorize conversation
    static async vectorizeConversation(userId, conversationId, messages, courseId = null) {
        try {
            console.log(`💬 Vectorizing conversation ${conversationId}...`);

            // Group messages into pairs (user message + AI response)
            const conversationPairs = [];
            for (let i = 0; i < messages.length - 1; i += 2) {
                const userMessage = messages[i];
                const aiResponse = messages[i + 1];

                if (userMessage?.role === 'user' && aiResponse?.role === 'assistant') {
                    conversationPairs.push({
                        message: userMessage.content,
                        response: aiResponse.content,
                        context: aiResponse.metadata?.context || '',
                        courseId: courseId,
                        userId: userId,
                        conversationId: conversationId,
                        timestamp: new Date(userMessage.created_at)
                    });
                }
            }

            // Vectorize each conversation pair
            const results = [];
            for (const pair of conversationPairs) {
                try {
                    const result = await weaviateClient.data.creator()
                        .withClassName('ChatHistory')
                        .withProperties(pair)
                        .do();

                    results.push(result);
                } catch (error) {
                    console.error('Error vectorizing conversation pair:', error);
                }
            }

            console.log(`✅ Vectorized ${results.length} conversation pairs`);
            return results;
        } catch (error) {
            console.error('Error vectorizing conversation:', error);
            throw error;
        }
    }

    // Search similar conversations
    static async searchSimilarConversations(query, userId, courseId = null, limit = 3) {
        try {
            const result = await searchQueries.searchChatHistory(weaviateClient, query, userId, courseId, limit);
            return result.data?.Get?.ChatHistory || [];
        } catch (error) {
            console.error('Error searching similar conversations:', error);
            return [];
        }
    }
}

// =============================================
// RECORDING VECTORIZATION SERVICE
// =============================================

export class WeaviateRecordingService {

    // Vectorize recording
    static async vectorizeRecording(userId, recordingId, title, summary, transcription, courseId, duration) {
        try {
            console.log(`🎙️ Vectorizing recording ${recordingId}...`);

            const data = {
                summary: summary,
                transcription: transcription,
                title: title,
                courseId: courseId,
                userId: userId,
                recordingId: recordingId,
                duration: duration,
                createdAt: new Date()
            };

            const result = await weaviateClient.data.creator()
                .withClassName('RecordingSummary')
                .withProperties(data)
                .do();

            console.log('✅ Recording vectorized successfully');
            return result;
        } catch (error) {
            console.error('Error vectorizing recording:', error);
            throw error;
        }
    }

    // Search recordings
    static async searchRecordings(query, userId, courseId = null, limit = 3) {
        try {
            const result = await searchQueries.searchRecordings(weaviateClient, query, userId, courseId, limit);
            return result.data?.Get?.RecordingSummary || [];
        } catch (error) {
            console.error('Error searching recordings:', error);
            return [];
        }
    }
}

// =============================================
// SEARCH SERVICE
// =============================================

export class WeaviateSearchService {

    // Search Canvas content
    static async searchCanvasContent(query, userId, courseId = null, limit = 5) {
        try {
            const result = await searchQueries.searchCanvasContent(weaviateClient, query, userId, courseId, limit);
            return result.data?.Get?.CanvasContent || [];
        } catch (error) {
            console.error('Error searching Canvas content:', error);
            return [];
        }
    }

    // Search all content types
    static async searchAllContent(query, userId, courseId = null) {
        try {
            console.log(`🔍 Searching all content for: "${query}"`);

            const [canvasContent, chatHistory, recordings] = await Promise.all([
                this.searchCanvasContent(query, userId, courseId, 5),
                WeaviateChatService.searchSimilarConversations(query, userId, courseId, 3),
                WeaviateRecordingService.searchRecordings(query, userId, courseId, 2)
            ]);

            return {
                canvasContent: canvasContent || [],
                chatHistory: chatHistory || [],
                recordings: recordings || []
            };
        } catch (error) {
            console.error('Error in comprehensive search:', error);
            return {
                canvasContent: [],
                chatHistory: [],
                recordings: []
            };
        }
    }

    // Get content by similarity threshold
    static async getContentBySimilarity(query, userId, courseId = null, threshold = 0.7) {
        try {
            // Note: Weaviate doesn't directly support similarity thresholds in this way,
            // but we can filter results based on distance if needed
            const results = await this.searchAllContent(query, userId, courseId);

            // For now, return all results - in production you might want to implement
            // custom similarity filtering based on distance scores
            return results;
        } catch (error) {
            console.error('Error getting content by similarity:', error);
            return {
                canvasContent: [],
                chatHistory: [],
                recordings: []
            };
        }
    }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

export class WeaviateUtils {

    // Batch operations
    static async batchCreateObjects(className, objects) {
        try {
            const batcher = weaviateClient.batch.objectsBatcher();

            objects.forEach(obj => {
                batcher.withObject({
                    class: className,
                    properties: obj
                });
            });

            const result = await batcher.do();
            return result;
        } catch (error) {
            console.error('Error in batch create:', error);
            throw error;
        }
    }

    // Delete objects by filter
    static async deleteObjectsByFilter(className, whereFilter) {
        try {
            const result = await weaviateClient.batch.objectsBatchDeleter()
                .withClassName(className)
                .withWhere(whereFilter)
                .do();

            return result;
        } catch (error) {
            console.error('Error deleting objects:', error);
            throw error;
        }
    }

    // Get object count
    static async getObjectCount(className, whereFilter = null) {
        try {
            let query = weaviateClient.graphql.aggregate()
                .withClassName(className)
                .withFields('meta { count }');

            if (whereFilter) {
                query = query.withWhere(whereFilter);
            }

            const result = await query.do();
            return result.data?.Aggregate?.[className]?.[0]?.meta?.count || 0;
        } catch (error) {
            console.error('Error getting object count:', error);
            return 0;
        }
    }
}

// Export the main client for direct use if needed
export default weaviateClient; 