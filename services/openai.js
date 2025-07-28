// =============================================
// CLARYFY OPENAI SERVICE
// =============================================

import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { GeminiQueryService } from './gemini.js';
import { ConversationService } from './conversation.js';
import { weaviateClient } from './weaviate.js';

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.');
}

// Helper for OpenAI embeddings
export async function getQueryEmbedding(query) {
    const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
    });
    return embeddingResponse.data[0].embedding;
}

// Configuration
const CONFIG = {
    MODEL: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    MAX_TOKENS: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
    TEMPERATURE: 0.7,
    WHISPER_MODEL: 'whisper-1'
};

// =============================================
// CHAT COMPLETION SERVICE
// =============================================

export class OpenAIChatService {
    // Generate chat completion
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

    // Get embedding for text
    static async getEmbedding(text) {
        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: text,
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error('Error getting embedding:', error);
            throw error;
        }
    }

    // Generate streaming chat completion
    static async generateStreamingChatResponse(messages, options = {}) {
        try {
            const response = await openai.chat.completions.create({
                model: options.model || CONFIG.MODEL,
                messages: messages,
                max_tokens: options.max_tokens || options.maxTokens || CONFIG.MAX_TOKENS,
                temperature: options.temperature || CONFIG.TEMPERATURE,
                stream: true,
                ...options
            });

            return response;
        } catch (error) {
            console.error('Error generating streaming chat response:', error);
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

            // 7. Use Query Agent for enhanced search
            const searchResponse = await weaviateClient.qa.run(
                message,
                {
                    collections: [
                        {
                            name: 'CanvasContent',
                            viewProperties: ['content', 'title', 'type', 'courseId', 'userId', 'canvasId', 'metadata']
                        },
                        {
                            name: 'ChatHistory',
                            viewProperties: ['message', 'response', 'context', 'conversationId']
                        }
                    ],
                    context: {
                        userId,
                        courseId,
                        queryParams,
                        searchConfig
                    }
                }
            );

            // 8. Build enhanced context-aware prompt
            const messages = this.buildEnhancedContextPrompt(
                message,
                searchResponse,
                conversationContext,
                userCourses,
                queryParams,
                searchSummary
            );

            // 9. Generate streaming response
            console.log('🤖 Generating enhanced AI response...');
            const stream = await OpenAIChatService.generateStreamingChatResponse(messages, {
                stream: true
            });

            // 10. Save assistant response to conversation (done after streaming)
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

    // Helper methods...
    static async getUserCourses(supabaseClient, userId) {
        try {
            const { data: courses } = await supabaseClient
                .from('canvas_courses')
                .select('*')
                .eq('user_id', userId);
            return courses || [];
        } catch (error) {
            console.error('Error getting user courses:', error);
            return [];
        }
    }

    static buildEnhancedContextPrompt(message, searchResults, conversationContext, courseInfo, queryParams, searchSummary) {
        return [
            {
                role: 'system',
                content: `You are Claryfy, an intelligent Canvas LMS assistant. Use the provided context to give helpful, accurate responses.
                         Current context:
                         - Search summary: ${searchSummary}
                         - Course info: ${JSON.stringify(courseInfo)}
                         - Query parameters: ${JSON.stringify(queryParams)}`
            },
            ...conversationContext.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            {
                role: 'user',
                content: message
            }
        ];
    }

    static async saveAssistantResponse(conversationId, stream) {
        let fullResponse = '';
        for await (const chunk of stream) {
            fullResponse += chunk.choices[0]?.delta?.content || '';
        }
        await ConversationService.addMessage(conversationId, fullResponse, 'assistant');
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