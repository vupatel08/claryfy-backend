import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import weaviate from 'weaviate-client';
import { QueryAgent } from 'weaviate-agents';

dotenv.config();

// =============================================
// SUPABASE CONFIGURATION
// =============================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

// Initialize Supabase client if configuration is available
if (supabaseUrl && supabaseServiceKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseServiceKey);
        console.log('✅ Supabase conversation service initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Supabase client:', error);
    }
} else {
    console.log('⚠️ Supabase configuration missing. Conversation history will be disabled.');
    console.log('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables to enable.');
}

// =============================================
// CONVERSATION MANAGEMENT SERVICE
// =============================================

export class ConversationService {

    /**
     * Check if Supabase is available
     * @returns {boolean} Whether Supabase is configured
     */
    static isAvailable() {
        return supabase !== null;
    }

    /**
     * Create a new conversation
     * @param {string} userId - User ID from Supabase auth
     * @param {string} title - Conversation title
     * @param {number} courseId - Canvas course ID (optional)
     * @returns {Object} Created conversation
     */
    static async createConversation(userId, title, courseId = null) {
        if (!this.isAvailable()) {
            console.log('⚠️ Supabase not available, skipping conversation creation');
            return { id: `temp-${Date.now()}`, title, user_id: userId, course_id: courseId };
        }

        try {
            console.log('💬 Creating new conversation for user:', userId);

            const { data, error } = await supabase
                .from('conversations')
                .insert({
                    user_id: userId,
                    title: title,
                    course_id: courseId
                })
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log('✅ Created conversation:', data.id);
            return data;

        } catch (error) {
            console.error('Error creating conversation:', error);
            // Return a temporary conversation for fallback
            return { id: `temp-${Date.now()}`, title, user_id: userId, course_id: courseId };
        }
    }

    /**
     * Get or create a conversation based on title and course
     * @param {string} userId - User ID
     * @param {string} title - Conversation title
     * @param {number} courseId - Canvas course ID (optional)
     * @returns {Object} Existing or newly created conversation
     */
    static async getOrCreateConversation(userId, title, courseId = null) {
        if (!this.isAvailable()) {
            return { id: `temp-${Date.now()}`, title, user_id: userId, course_id: courseId };
        }

        try {
            // First, try to find an existing conversation
            const { data: existingConversations, error: fetchError } = await supabase
                .from('conversations')
                .select('*')
                .eq('user_id', userId)
                .eq('course_id', courseId)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (fetchError) {
                throw fetchError;
            }

            // If we have a recent conversation for this course, use it
            if (existingConversations && existingConversations.length > 0) {
                const conversation = existingConversations[0];

                // Update the title if it's different
                if (conversation.title !== title) {
                    await this.updateConversation(conversation.id, { title });
                    conversation.title = title;
                }

                return conversation;
            }

            // Create a new conversation if none exists
            return await this.createConversation(userId, title, courseId);

        } catch (error) {
            console.error('Error getting or creating conversation:', error);
            return { id: `temp-${Date.now()}`, title, user_id: userId, course_id: courseId };
        }
    }

    /**
     * Get conversation history for a user
     * @param {string} userId - User ID
     * @param {number} limit - Number of conversations to return
     * @param {number} courseId - Filter by course ID (optional)
     * @returns {Array} Array of conversations
     */
    static async getConversations(userId, limit = 10, courseId = null) {
        if (!this.isAvailable()) return [];
        try {
            let query = supabase
                .from('conversations')
                .select(`
                    *,
                    messages(
                        id,
                        content,
                        role,
                        created_at
                    )
                `)
                .eq('user_id', userId)
                .order('updated_at', { ascending: false })
                .limit(limit);

            if (courseId !== null) {
                query = query.eq('course_id', courseId);
            }

            const { data, error } = await query;

            if (error) {
                throw error;
            }

            return data || [];

        } catch (error) {
            console.error('Error fetching conversations:', error);
            return [];
        }
    }

    /**
     * Add a message to a conversation
     * @param {string} conversationId - Conversation ID
     * @param {string} content - Message content
     * @param {string} role - Message role ('user' or 'assistant')
     * @param {Object} metadata - Additional metadata (optional)
     * @returns {Object} Created message
     */
    static async addMessage(conversationId, content, role, metadata = {}) {
        if (!this.isAvailable()) {
            console.log('⚠️ Supabase not available, skipping message save');
            return { id: `temp-${Date.now()}`, conversation_id: conversationId, content, role, metadata };
        }

        // Skip temporary conversations
        if (conversationId.startsWith('temp-')) {
            console.log('⚠️ Skipping message save for temporary conversation');
            return { id: `temp-${Date.now()}`, conversation_id: conversationId, content, role, metadata };
        }

        try {
            console.log(`💬 Adding ${role} message to conversation:`, conversationId);

            const { data: message, error: messageError } = await supabase
                .from('messages')
                .insert({
                    conversation_id: conversationId,
                    content: content,
                    role: role,
                    metadata: metadata
                })
                .select()
                .single();

            if (messageError) {
                throw messageError;
            }

            // Update the conversation's updated_at timestamp
            await this.updateConversation(conversationId, {});

            console.log('✅ Added message:', message.id);
            return message;

        } catch (error) {
            console.error('Error adding message:', error);
            return { id: `temp-${Date.now()}`, conversation_id: conversationId, content, role, metadata };
        }
    }

    /**
     * Get messages for a conversation
     * @param {string} conversationId - Conversation ID
     * @param {number} limit - Number of messages to return
     * @returns {Array} Array of messages
     */
    static async getMessages(conversationId, limit = 50) {
        if (!this.isAvailable()) return [];
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true })
                .limit(limit);

            if (error) {
                throw error;
            }

            return data || [];

        } catch (error) {
            console.error('Error fetching messages:', error);
            return [];
        }
    }

    /**
     * Get recent conversation context for RAG
     * @param {string} userId - User ID
     * @param {number} courseId - Course ID (optional)
     * @param {number} limit - Number of recent messages to return
     * @returns {Array} Array of recent messages
     */
    static async getRecentContext(userId, courseId = null, limit = 10) {
        if (!this.isAvailable()) {
            console.log('⚠️ Supabase not available, returning empty context');
            return [];
        }

        try {
            let query = supabase
                .from('messages')
                .select(`
                    *,
                    conversations!inner(
                        user_id,
                        course_id
                    )
                `)
                .eq('conversations.user_id', userId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (courseId !== null) {
                query = query.eq('conversations.course_id', courseId);
            }

            const { data, error } = await query;

            if (error) {
                throw error;
            }

            // Return in chronological order for context
            return (data || []).reverse();

        } catch (error) {
            console.error('Error fetching recent context:', error);
            return [];
        }
    }

    /**
     * Update conversation metadata
     * @param {string} conversationId - Conversation ID
     * @param {Object} updates - Fields to update
     * @returns {Object} Updated conversation
     */
    static async updateConversation(conversationId, updates) {
        if (!this.isAvailable() || conversationId.startsWith('temp-')) {
            return { id: conversationId, ...updates };
        }

        try {
            const { data, error } = await supabase
                .from('conversations')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', conversationId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            return data;

        } catch (error) {
            console.error('Error updating conversation:', error);
            return { id: conversationId, ...updates };
        }
    }

    /**
     * Delete a conversation and all its messages
     * @param {string} conversationId - Conversation ID
     * @param {string} userId - User ID (for security)
     * @returns {boolean} Success status
     */
    static async deleteConversation(conversationId, userId) {
        if (!this.isAvailable()) return true;
        try {
            // Verify ownership
            const { data: conversation, error: fetchError } = await supabase
                .from('conversations')
                .select('user_id')
                .eq('id', conversationId)
                .eq('user_id', userId)
                .single();

            if (fetchError || !conversation) {
                throw new Error('Conversation not found or access denied');
            }

            // Delete conversation (messages will be deleted via CASCADE)
            const { error: deleteError } = await supabase
                .from('conversations')
                .delete()
                .eq('id', conversationId);

            if (deleteError) {
                throw deleteError;
            }

            console.log('🗑️ Deleted conversation:', conversationId);
            return true;

        } catch (error) {
            console.error('Error deleting conversation:', error);
            throw error;
        }
    }

    /**
     * Generate conversation title from first message
     * @param {string} firstMessage - First user message
     * @returns {string} Generated title
     */
    static generateTitle(firstMessage) {
        // Keep first 50 characters and clean up
        const title = firstMessage
            .replace(/[^\w\s]/g, '') // Remove special characters
            .trim()
            .substring(0, 50);

        return title || 'New Conversation';
    }

    /**
     * Search conversations by content
     * @param {string} userId - User ID
     * @param {string} searchQuery - Search query
     * @param {number} limit - Number of results
     * @returns {Array} Array of matching conversations
     */
    static async searchConversations(userId, searchQuery, limit = 10) {
        if (!this.isAvailable()) return [];
        try {
            const { data, error } = await supabase
                .from('conversations')
                .select(`
                    *,
                    messages!inner(
                        id,
                        content,
                        role,
                        created_at
                    )
                `)
                .eq('user_id', userId)
                .ilike('messages.content', `%${searchQuery}%`)
                .order('updated_at', { ascending: false })
                .limit(limit);

            if (error) {
                throw error;
            }

            return data || [];

        } catch (error) {
            console.error('Error searching conversations:', error);
            return [];
        }
    }
}

export default ConversationService; 