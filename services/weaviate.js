// =============================================
// CLARYFY WEAVIATE SERVICE
// =============================================

import weaviate, { ApiKey } from 'weaviate-ts-client';
import * as dotenv from 'dotenv';
import { createWeaviateSchemas } from '../weaviate-schema.js';

dotenv.config();

// Initialize Weaviate client
const weaviateUrl = process.env.WEAVIATE_URL;
const weaviateApiKey = process.env.WEAVIATE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!weaviateUrl || !weaviateApiKey) {
    console.log('⚠️ Weaviate configuration missing. Vector search features will be disabled.');
    console.log('   Set WEAVIATE_URL and WEAVIATE_API_KEY environment variables to enable vector search.');
}

// Initialize Weaviate client for management operations only
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

    // Clear user data
    static async clearUserData(userId, className) {
        try {
            console.log(`🗑️ Clearing existing data for user ${userId} in ${className}...`);

            await weaviateClient.batch.objectsBatchDeleter()
                .withClassName(className)
                .withWhere({
                    path: ['userId'],
                    operator: 'Equal',
                    valueString: userId
                })
                .do();

            console.log(`✅ Existing data cleared from ${className}`);
        } catch (error) {
            console.error(`Error clearing user data from ${className}:`, error);
            // Don't throw - this is not critical
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

// =============================================
// QUERY AGENT ERROR HANDLER
// =============================================

export class QueryAgentErrorHandler {
    static async handleError(error, operation, context) {
        console.error(`Query Agent error during ${operation}:`, error);

        // Log error details for monitoring
        const errorDetails = {
            operation,
            context,
            error: {
                message: error.message,
                name: error.name,
                stack: error.stack
            },
            timestamp: new Date().toISOString()
        };

        console.error('Error details:', errorDetails);

        // Handle specific error types
        switch (operation) {
            case 'chat':
                return this.handleChatError(error, context);
            case 'vectorize':
                return this.handleVectorizeError(error, context);
            case 'sync':
                return this.handleSyncError(error, context);
            default:
                throw new Error(`Unhandled Query Agent operation: ${operation}`);
        }
    }

    static async handleChatError(error, context) {
        // Provide a fallback response for chat errors
        return {
            success: false,
            error: error.message,
            fallback: {
                response: "I apologize, but I encountered an error processing your request. Please try again or rephrase your question.",
                source: "error_handler"
            }
        };
    }

    static async handleVectorizeError(error, context) {
        const { file } = context;

        // For vectorization errors, try to save basic metadata
        try {
            const basicData = {
                content: `${file.display_name} ${file.filename || ''} ${file.description || ''}`.trim(),
                title: file.display_name,
                type: 'file',
                courseId: file.course_id,
                userId: context.userId,
                canvasId: file.id.toString(),
                metadata: {
                    filename: file.filename,
                    contentType: file.content_type,
                    size: file.size,
                    url: file.url
                }
            };

            return {
                success: false,
                error: error.message,
                fallback: {
                    data: basicData,
                    source: "error_handler"
                }
            };
        } catch (fallbackError) {
            return {
                success: false,
                error: `${error.message} (Fallback also failed: ${fallbackError.message})`
            };
        }
    }

    static async handleSyncError(error, context) {
        // For sync errors, try to process data in smaller batches
        try {
            const { canvasData, userId } = context;
            const results = {
                assignments: [],
                announcements: [],
                files: []
            };

            // Process in smaller chunks
            const SAFE_CHUNK_SIZE = 10;

            // Helper function to process chunks
            const processChunk = async (items, type) => {
                for (let i = 0; i < items.length; i += SAFE_CHUNK_SIZE) {
                    const chunk = items.slice(i, i + SAFE_CHUNK_SIZE);
                    try {
                        const chunkData = chunk.map(item => ({
                            content: item.description || item.name || item.message || '',
                            title: item.name || item.title || item.display_name || '',
                            type: type,
                            courseId: item.course_id,
                            userId: userId,
                            canvasId: item.id.toString(),
                            metadata: {
                                // Basic metadata only
                                createdAt: item.created_at
                            }
                        }));

                        results[type].push(...chunkData);
                    } catch (chunkError) {
                        console.error(`Error processing ${type} chunk:`, chunkError);
                    }
                }
            };

            // Process each type in smaller chunks
            if (canvasData.assignments?.length) {
                await processChunk(canvasData.assignments, 'assignments');
            }
            if (canvasData.announcements?.length) {
                await processChunk(canvasData.announcements, 'announcements');
            }
            if (canvasData.files?.length) {
                await processChunk(canvasData.files, 'files');
            }

            return {
                success: false,
                error: error.message,
                fallback: {
                    results,
                    source: "error_handler",
                    message: "Processed with reduced functionality"
                }
            };
        } catch (fallbackError) {
            return {
                success: false,
                error: `${error.message} (Fallback also failed: ${fallbackError.message})`
            };
        }
    }
}

// =============================================
// CANVAS CONTENT VECTORIZATION SERVICE
// =============================================

export class WeaviateCanvasService {
    static async vectorizeAllCanvasData(userId, canvasData, canvasToken = null, canvasDomain = null) {
        try {
            console.log('🔄 Starting Canvas data vectorization...');

            // Clear existing data first
            await WeaviateManagementService.clearUserData(userId, 'CanvasContent');

            const results = {
                files: [],
                assignments: [],
                announcements: []
            };

            // Prepare Canvas client if needed
            let canvasClient = null;
            if (canvasToken && canvasDomain) {
                const { CanvasClient } = await import('../build/client.js');
                canvasClient = new CanvasClient(canvasToken, canvasDomain);
            }

            // Process files with content extraction
            if (canvasData.files?.length) {
                console.log(`📄 Processing ${canvasData.files.length} files...`);
                for (const file of canvasData.files) {
                    try {
                        let content = `${file.display_name} ${file.filename || ''}`;
                        let skipFile = false;

                        // Extract content from PDFs
                        if (file.content_type === 'application/pdf') {
                            try {
                                let downloadUrl = file.url;
                                if (canvasClient) {
                                    // Always get a fresh URL from Canvas
                                    const freshFile = await canvasClient.getFile(file.id);
                                    downloadUrl = freshFile.url;
                                    console.log(`🔗 [${file.display_name}] Got fresh download URL: ${downloadUrl}`);
                                }
                                const { FileProcessingService } = await import('./fileProcessing.js');
                                console.log(`📄 [${file.display_name}] Downloading PDF from: ${downloadUrl}`);
                                const pdfData = await FileProcessingService.processPDF(downloadUrl, {
                                    canvasToken: canvasToken
                                });
                                if (pdfData.content && pdfData.content.trim().length > 0) {
                                    content = pdfData.content;
                                    console.log(`✅ [${file.display_name}] PDF content extracted (${content.length} chars)`);
                                } else {
                                    console.error(`❌ [${file.display_name}] PDF extraction failed or empty!`);
                                    skipFile = true;
                                }
                            } catch (err) {
                                console.error(`❌ [${file.display_name}] Error extracting PDF:`, err);
                                skipFile = true;
                            }
                        }

                        if (skipFile) {
                            console.warn(`⚠️ [${file.display_name}] Skipping file due to extraction failure.`);
                            continue;
                        }

                        const fileData = {
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
                            }
                        };

                        // Add to Weaviate
                        await weaviateClient.data
                            .creator()
                            .withClassName('CanvasContent')
                            .withProperties(fileData)
                            .do();

                        results.files.push(fileData);
                        console.log(`✅ [${file.display_name}] File vectorized.`);
                    } catch (error) {
                        console.error(`Error processing file ${file.display_name}:`, error);
                    }
                }
            }

            // Process assignments
            if (canvasData.assignments?.length) {
                console.log(`📝 Processing ${canvasData.assignments.length} assignments...`);
                for (const assignment of canvasData.assignments) {
                    try {
                        const assignmentData = {
                            content: assignment.description || assignment.name,
                            title: assignment.name,
                            type: 'assignment',
                            courseId: assignment.course_id,
                            userId: userId,
                            canvasId: assignment.id.toString(),
                            metadata: {
                                dueAt: assignment.due_at,
                                pointsPossible: assignment.points_possible,
                                submissionTypes: assignment.submission_types
                            }
                        };

                        await weaviateClient.data
                            .creator()
                            .withClassName('CanvasContent')
                            .withProperties(assignmentData)
                            .do();

                        results.assignments.push(assignmentData);
                    } catch (error) {
                        console.error(`Error processing assignment ${assignment.name}:`, error);
                    }
                }
            }

            // Process announcements
            if (canvasData.announcements?.length) {
                console.log(`📢 Processing ${canvasData.announcements.length} announcements...`);
                for (const announcement of canvasData.announcements) {
                    try {
                        const announcementData = {
                            content: announcement.message || announcement.title,
                            title: announcement.title,
                            type: 'announcement',
                            courseId: announcement.course_id,
                            userId: userId,
                            canvasId: announcement.id.toString(),
                            metadata: {
                                postedAt: announcement.posted_at,
                                author: announcement.author
                            }
                        };

                        await weaviateClient.data
                            .creator()
                            .withClassName('CanvasContent')
                            .withProperties(announcementData)
                            .do();

                        results.announcements.push(announcementData);
                    } catch (error) {
                        console.error(`Error processing announcement ${announcement.title}:`, error);
                    }
                }
            }

            console.log('✅ Canvas data vectorization completed');
            return results;

        } catch (error) {
            console.error('Error vectorizing Canvas data:', error);
            throw error;
        }
    }

    static async clearUserData(userId) {
        return WeaviateManagementService.clearUserData(userId, 'CanvasContent');
    }
}

// =============================================
// RECORDING VECTORIZATION SERVICE
// =============================================

export class WeaviateRecordingService {
    static async vectorizeRecording(userId, recordingId, title, summary, transcription, courseId, duration) {
        try {
            console.log('🎙️ Vectorizing recording summary...');

            const recordingData = {
                summary: summary,
                transcription: transcription,
                title: title,
                courseId: courseId,
                userId: userId,
                recordingId: recordingId,
                duration: duration,
                createdAt: new Date().toISOString()
            };

            // Add to Weaviate RecordingSummary collection
            await weaviateClient.data
                .creator()
                .withClassName('RecordingSummary')
                .withProperties(recordingData)
                .do();

            console.log(`✅ Recording summary vectorized successfully for recording ${recordingId}`);
            return true;

        } catch (error) {
            console.error('Error vectorizing recording summary:', error);
            throw error;
        }
    }

    static async clearUserRecordings(userId) {
        return WeaviateManagementService.clearUserData(userId, 'RecordingSummary');
    }

    static async getRecordingCount(userId) {
        return WeaviateManagementService.getObjectCount('RecordingSummary', {
            path: ['userId'],
            operator: 'Equal',
            valueString: userId
        });
    }
}

// Export the client for Query Agent initialization only
export default weaviateClient; 