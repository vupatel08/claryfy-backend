// =============================================
// CLARYFY OPENAI SERVICE
// =============================================

import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { WeaviateSearchService } from './weaviate.js';
import { GeminiQueryService } from './gemini.js';
import { ConversationService } from './conversation.js';

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.');
}

// Configuration
const CONFIG = {
    MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    MAX_TOKENS: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
    TEMPERATURE: 0.7,
    WHISPER_MODEL: 'whisper-1'
};

// =============================================
// CHAT COMPLETION SERVICE
// =============================================

export class OpenAIChatService {

    // Generate chat completion with streaming
    static async generateChatResponse(messages, options = {}) {
        try {
            const response = await openai.chat.completions.create({
                model: options.model || CONFIG.MODEL,
                messages: messages,
                max_tokens: options.max_tokens || options.maxTokens || CONFIG.MAX_TOKENS,
                temperature: options.temperature || CONFIG.TEMPERATURE,
                stream: options.stream || false,
                ...options
            });

            return response;
        } catch (error) {
            console.error('Error generating chat response:', error);
            throw error;
        }
    }

    // Generate streaming chat response
    static async generateStreamingChatResponse(messages, options = {}) {
        try {
            const stream = await openai.chat.completions.create({
                model: options.model || CONFIG.MODEL,
                messages: messages,
                max_tokens: options.max_tokens || options.maxTokens || CONFIG.MAX_TOKENS,
                temperature: options.temperature || CONFIG.TEMPERATURE,
                stream: true,
                ...options
            });

            return stream;
        } catch (error) {
            console.error('Error generating streaming chat response:', error);
            throw error;
        }
    }

    // Generate summary of content
    static async generateSummary(content, options = {}) {
        try {
            const messages = [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that creates concise, informative summaries. Focus on the key points and main ideas.'
                },
                {
                    role: 'user',
                    content: `Please summarize the following content in ${options.maxSentences || 5} sentences or less:\n\n${content}`
                }
            ];

            const response = await this.generateChatResponse(messages, {
                max_tokens: options.maxTokens || 500,
                temperature: 0.3 // Lower temperature for more focused summaries
            });

            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('Error generating summary:', error);
            throw error;
        }
    }

    // Build context-aware prompt
    static buildContextPrompt(userMessage, canvasContext, chatHistory, courseInfo) {
        let systemPrompt = `You are Claryfy, an intelligent AI assistant for Canvas LMS. You help students with their coursework, assignments, and learning materials.

Context Guidelines:
- Be helpful, encouraging, and educational
- Reference specific Canvas content when relevant
- Provide actionable advice and study tips
- Keep responses focused and concise
- If you don't have enough context, ask clarifying questions`;

        if (courseInfo) {
            systemPrompt += `\n\nCurrent Course: ${courseInfo.name} (${courseInfo.code})`;
        }

        const messages = [{ role: 'system', content: systemPrompt }];

        // Add chat history for context (last 5 messages)
        if (chatHistory && chatHistory.length > 0) {
            const recentHistory = chatHistory.slice(-5);
            recentHistory.forEach(msg => {
                // Validate that message has required fields
                if (msg && msg.role && msg.content) {
                    messages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    });
                }
            });
        }

        // Add Canvas context if available
        if (canvasContext && canvasContext.length > 0) {
            const contextSummary = canvasContext.map(item => {
                return `${item.type}: ${item.title}\n${item.content || ''}`;
            }).join('\n\n');

            messages.push({
                role: 'system',
                content: `Relevant Canvas Content:\n${contextSummary}`
            });
        }

        // Add current user message
        messages.push({ role: 'user', content: userMessage });

        // Validate final messages array
        const validMessages = messages.filter(msg => msg.role && msg.content);

        console.log(`📝 Built ${validMessages.length} messages for OpenAI`);
        return validMessages;
    }
}

// =============================================
// AUDIO TRANSCRIPTION SERVICE
// =============================================

export class OpenAIAudioService {

    // Transcribe audio using Whisper
    static async transcribeAudio(audioFile, options = {}) {
        try {
            const response = await openai.audio.transcriptions.create({
                file: audioFile,
                model: CONFIG.WHISPER_MODEL,
                language: options.language || 'en',
                response_format: options.responseFormat || 'text',
                temperature: options.temperature || 0.0
            });

            return response;
        } catch (error) {
            console.error('Error transcribing audio:', error);
            throw error;
        }
    }

    // Generate lecture summary from transcription
    static async generateLectureSummary(transcription, courseInfo = null) {
        try {
            let prompt = `Please create a comprehensive summary of this lecture transcription. Include:

1. Main topics covered
2. Key concepts and definitions
3. Important points to remember
4. Any assignments or deadlines mentioned

Transcription:
${transcription}`;

            if (courseInfo) {
                prompt = `Course: ${courseInfo.name} (${courseInfo.code})\n\n${prompt}`;
            }

            const messages = [
                {
                    role: 'system',
                    content: 'You are an expert at creating educational summaries from lecture transcriptions. Focus on extracting the most important educational content.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ];

            const response = await OpenAIChatService.generateChatResponse(messages, {
                max_tokens: 800,
                temperature: 0.3
            });

            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('Error generating lecture summary:', error);
            throw error;
        }
    }
}

// =============================================
// RAG (RETRIEVAL AUGMENTED GENERATION) SERVICE
// =============================================

export class OpenAIRAGService {

    /**
     * Enhanced chat message handler with Gemini query processing and Supabase history
     * @param {string} userId - User ID from Supabase
     * @param {string} message - User message
     * @param {number} courseId - Canvas course ID (optional)
     * @param {Object} weaviateClient - Weaviate client
     * @param {Object} supabaseClient - Supabase client
     * @param {string} conversationId - Existing conversation ID (optional)
     * @returns {ReadableStream} Streaming response
     */
    static async handleChatMessage(userId, message, courseId, weaviateClient, supabaseClient, conversationId = null) {
        try {
            console.log('🚀 Enhanced RAG pipeline starting...');

            // 1. Get user's courses for context
            const userCourses = await this.getUserCourses(supabaseClient, userId);
            console.log('📚 Found user courses:', userCourses.length);

            // 2. Process query with Gemini for enhanced search
            console.log('🔍 Processing query with Gemini...');
            const queryParams = await GeminiQueryService.processQuery(message, userCourses);
            const searchSummary = GeminiQueryService.generateSearchSummary(queryParams);
            console.log('📋 Query analysis:', searchSummary);

            // 3. Build enhanced search configuration
            const searchConfig = GeminiQueryService.buildSearchQuery(queryParams, message);
            console.log('🎯 Enhanced search config:', searchConfig);

            // 4. Get or create conversation
            const conversationTitle = ConversationService.generateTitle(message);
            const conversation = conversationId
                ? { id: conversationId }
                : await ConversationService.getOrCreateConversation(userId, conversationTitle, courseId);

            console.log('💬 Using conversation:', conversation.id);

            // 5. Add user message to conversation history
            await ConversationService.addMessage(conversation.id, message, 'user', {
                queryParams: queryParams,
                searchConfig: searchConfig
            });

            // 6. Get conversation context from Supabase
            const conversationContext = await ConversationService.getRecentContext(userId, courseId, 6);
            console.log('📜 Conversation context:', conversationContext.length, 'messages');

            // 7. Search Canvas content with enhanced query
            let canvasContext = [];
            try {
                if (queryParams.searchType !== 'general') {
                    // Use enhanced search query
                    canvasContext = await this.searchCanvasContextEnhanced(
                        weaviateClient,
                        searchConfig.query,
                        userId,
                        this.determineCourseId(queryParams, courseId, userCourses),
                        searchConfig.limit
                    );
                    console.log('📝 Found Canvas content:', canvasContext.length, 'items');
                } else {
                    // Fall back to original search for general queries
                    canvasContext = await this.searchCanvasContext(weaviateClient, message, userId, courseId);
                }
            } catch (error) {
                console.error('Error searching Canvas context:', error);
            }

            // 8. Search chat history (Weaviate)
            let chatHistory = [];
            try {
                chatHistory = await this.searchChatHistory(weaviateClient, searchConfig.query, userId, courseId);
                console.log('💭 Found chat history:', chatHistory.length, 'items');
            } catch (error) {
                console.error('Error searching chat history:', error);
            }

            // 9. Get course information
            let courseInfo = null;
            try {
                const targetCourseId = this.determineCourseId(queryParams, courseId, userCourses);
                if (targetCourseId) {
                    courseInfo = await this.getCourseInfo(supabaseClient, targetCourseId, userId);
                }
            } catch (error) {
                console.error('Error getting course info:', error);
            }

            // 10. Combine all context
            const allContext = [...canvasContext, ...chatHistory];

            // 11. Build enhanced context-aware prompt
            const messages = this.buildEnhancedContextPrompt(
                message,
                allContext,
                conversationContext,
                courseInfo,
                queryParams,
                searchSummary
            );

            // 12. Generate streaming response
            console.log('🤖 Generating enhanced AI response...');
            const stream = await OpenAIChatService.generateStreamingChatResponse(messages, {
                stream: true
            });

            // 13. Save assistant response to conversation (done after streaming)
            this.saveAssistantResponse(conversation.id, stream);

            return {
                stream,
                conversationId: conversation.id,
                queryParams,
                searchSummary
            };

        } catch (error) {
            console.error('Error in enhanced RAG pipeline:', error);

            // Enhanced fallback with conversation tracking
            try {
                const fallbackConversation = conversationId
                    ? { id: conversationId }
                    : await ConversationService.getOrCreateConversation(userId, 'Fallback Chat', courseId);

                await ConversationService.addMessage(fallbackConversation.id, message, 'user', {
                    error: 'Enhanced pipeline failed, using fallback'
                });

                const fallbackMessages = [
                    {
                        role: 'system',
                        content: 'You are Claryfy, a helpful AI assistant for students. Provide a helpful response even though context is limited.'
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ];

                const fallbackStream = await OpenAIChatService.generateStreamingChatResponse(fallbackMessages, {
                    stream: true
                });

                this.saveAssistantResponse(fallbackConversation.id, fallbackStream);

                return {
                    stream: fallbackStream,
                    conversationId: fallbackConversation.id,
                    queryParams: null,
                    searchSummary: 'Fallback response'
                };

            } catch (fallbackError) {
                console.error('Both enhanced and fallback pipelines failed:', fallbackError);
                throw new Error('All AI response methods failed');
            }
        }
    }

    /**
     * Determine the best course ID to use for search
     * @param {Object} queryParams - Processed query parameters
     * @param {number} courseId - Provided course ID
     * @param {Array} userCourses - User's courses
     * @returns {number|null} Best course ID to use
     */
    static determineCourseId(queryParams, courseId, userCourses) {
        // If query specifies a course, find its ID
        if (queryParams.courseFilter) {
            const course = userCourses.find(c =>
                c.course_code === queryParams.courseFilter ||
                c.name.includes(queryParams.courseFilter)
            );
            return course ? course.id : courseId;
        }

        // Otherwise use provided course ID
        return courseId;
    }

    /**
     * Enhanced Canvas context search with better query
     * @param {Object} weaviateClient - Weaviate client
     * @param {string} query - Enhanced search query
     * @param {string} userId - User ID
     * @param {number} courseId - Course ID
     * @param {number} limit - Results limit
     * @returns {Array} Search results
     */
    static async searchCanvasContextEnhanced(weaviateClient, query, userId, courseId, limit = 5) {
        // Use the existing search method but with enhanced query
        return await this.searchCanvasContext(weaviateClient, query, userId, courseId, limit);
    }

    /**
     * Build enhanced context prompt with conversation history
     * @param {string} userMessage - User message
     * @param {Array} canvasContext - Canvas content context
     * @param {Array} conversationContext - Recent conversation messages
     * @param {Object} courseInfo - Course information
     * @param {Object} queryParams - Processed query parameters
     * @param {string} searchSummary - Search summary
     * @returns {Array} Messages array for OpenAI
     */
    static buildEnhancedContextPrompt(userMessage, canvasContext, conversationContext, courseInfo, queryParams, searchSummary) {
        let systemPrompt = `You are Claryfy, an intelligent AI assistant for Canvas LMS. You help students with their coursework, assignments, and learning materials.

Query Analysis: ${searchSummary}

Context Guidelines:
- Be helpful, encouraging, and educational
- Reference specific Canvas content when relevant
- Provide actionable advice and study tips
- Keep responses focused and concise
- If you don't have enough context, ask clarifying questions
- Maintain conversation continuity using chat history`;

        if (courseInfo) {
            systemPrompt += `\n\nCurrent Course: ${courseInfo.name} (${courseInfo.code})`;
        }

        if (queryParams && queryParams.intent) {
            systemPrompt += `\n\nUser Intent: ${queryParams.intent.replace('_', ' ')}`;
        }

        const messages = [{ role: 'system', content: systemPrompt }];

        // Add conversation history for context (last 4 messages)
        if (conversationContext && conversationContext.length > 0) {
            const recentMessages = conversationContext.slice(-4);
            for (const msg of recentMessages) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    messages.push({
                        role: msg.role,
                        content: msg.content
                    });
                }
            }
        }

        // Add Canvas context
        if (canvasContext && canvasContext.length > 0) {
            const contextText = canvasContext.map(item => {
                const typeLabel = item.type ? `[${item.type.toUpperCase()}]` : '[CONTENT]';
                return `${typeLabel} ${item.title}: ${item.content}`;
            }).join('\n\n');

            messages.push({
                role: 'system',
                content: `Relevant Canvas Content:\n\n${contextText}`
            });
        }

        // Add current user message
        messages.push({
            role: 'user',
            content: userMessage
        });

        console.log('📝 Built', messages.length, 'messages for enhanced AI context');
        return messages;
    }

    /**
     * Save assistant response to conversation history
     * @param {string} conversationId - Conversation ID
     * @param {ReadableStream} stream - Response stream
     */
    static async saveAssistantResponse(conversationId, stream) {
        // This will collect the streamed response and save it
        // Implementation would require stream cloning or post-processing
        setTimeout(async () => {
            try {
                // For now, save a placeholder - in production you'd capture the actual response
                await ConversationService.addMessage(conversationId, '[Response generated]', 'assistant', {
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Error saving assistant response:', error);
            }
        }, 1000);
    }

    /**
     * Get user's courses from Canvas data
     * @param {Object} supabaseClient - Supabase client
     * @param {string} userId - User ID
     * @returns {Array} User's courses
     */
    static async getUserCourses(supabaseClient, userId) {
        try {
            const { data } = await supabaseClient
                .from('canvas_data')
                .select('content')
                .eq('user_id', userId)
                .eq('data_type', 'courses')
                .single();

            return data?.content || [];
        } catch (error) {
            console.error('Error getting user courses:', error);
            return [];
        }
    }

    // Search Canvas context
    static async searchCanvasContext(weaviateClient, query, userId, courseId, limit = 5) {
        try {
            let whereClause;

            if (courseId && courseId !== null) {
                // Search within specific course
                whereClause = {
                    operator: 'And',
                    operands: [
                        { path: ['userId'], operator: 'Equal', valueString: userId },
                        { path: ['courseId'], operator: 'Equal', valueInt: courseId }
                    ]
                };
            } else {
                // Search across all courses for this user
                whereClause = {
                    operator: 'Equal',
                    path: ['userId'],
                    valueString: userId
                };
            }

            const response = await weaviateClient.graphql
                .get()
                .withClassName('CanvasContent')
                .withFields('title content type courseId canvasId')
                .withNearText({ concepts: [query] })
                .withWhere(whereClause)
                .withLimit(limit)
                .do();

            return response.data?.Get?.CanvasContent || [];
        } catch (error) {
            console.error('Error searching Canvas context:', error);
            return [];
        }
    }

    // Search chat history
    static async searchChatHistory(weaviateClient, query, userId, courseId, limit = 3) {
        try {
            let whereClause;

            if (courseId && courseId !== null) {
                // Search within specific course
                whereClause = {
                    operator: 'And',
                    operands: [
                        { path: ['userId'], operator: 'Equal', valueString: userId },
                        { path: ['courseId'], operator: 'Equal', valueInt: courseId }
                    ]
                };
            } else {
                // Search across all courses for this user
                whereClause = {
                    operator: 'Equal',
                    path: ['userId'],
                    valueString: userId
                };
            }

            const response = await weaviateClient.graphql
                .get()
                .withClassName('ChatHistory')
                .withFields('message response context conversationId')
                .withNearText({ concepts: [query] })
                .withWhere(whereClause)
                .withLimit(limit)
                .do();

            return response.data?.Get?.ChatHistory || [];
        } catch (error) {
            console.error('Error searching chat history:', error);
            return [];
        }
    }

    // Get course information
    static async getCourseInfo(supabaseClient, courseId, userId) {
        try {
            const { data } = await supabaseClient
                .from('canvas_data')
                .select('content')
                .eq('user_id', userId)
                .eq('data_type', 'courses')
                .eq('course_id', courseId)
                .single();

            return data?.content || null;
        } catch (error) {
            console.error('Error getting course info:', error);
            return null;
        }
    }
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

export class OpenAIUtils {

    // Count tokens in text (approximate)
    static countTokens(text) {
        // Rough approximation: 1 token ≈ 4 characters for English
        return Math.ceil(text.length / 4);
    }

    // Truncate text to fit within token limit
    static truncateToTokenLimit(text, maxTokens) {
        const estimatedTokens = this.countTokens(text);
        if (estimatedTokens <= maxTokens) {
            return text;
        }

        const ratio = maxTokens / estimatedTokens;
        const truncatedLength = Math.floor(text.length * ratio * 0.9); // 90% safety margin
        return text.substring(0, truncatedLength) + '...';
    }

    // Validate API key
    static async validateApiKey() {
        try {
            await openai.models.list();
            return true;
        } catch (error) {
            console.error('Invalid OpenAI API key:', error);
            return false;
        }
    }
}

// Export OpenAI client for direct use if needed
export default openai; 