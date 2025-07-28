// =============================================
// CLARYFY SUPABASE SERVICE
// =============================================

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for backend operations

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration. Please check SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// =============================================
// USER MANAGEMENT
// =============================================

export class SupabaseUserService {

    // Get user profile by ID
    static async getUserProfile(userId) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching user profile:', error);
            throw error;
        }
    }

    // Update user profile (including Canvas token)
    static async updateUserProfile(userId, updates) {
        try {
            const { data, error } = await supabase
                .from('users')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', userId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error updating user profile:', error);
            throw error;
        }
    }

    // Get user's Canvas credentials
    static async getCanvasCredentials(userId) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('canvas_token, canvas_domain')
                .eq('id', userId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching Canvas credentials:', error);
            throw error;
        }
    }
}

// =============================================
// CONVERSATION MANAGEMENT
// =============================================

export class SupabaseConversationService {

    // Create new conversation
    static async createConversation(userId, courseId, title) {
        try {
            const { data, error } = await supabase
                .from('conversations')
                .insert({
                    user_id: userId,
                    course_id: courseId,
                    title: title
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error creating conversation:', error);
            throw error;
        }
    }

    // Get user conversations
    static async getUserConversations(userId, courseId = null) {
        try {
            let query = supabase
                .from('conversation_summary')
                .select('*')
                .eq('user_id', userId)
                .order('last_message_at', { ascending: false });

            if (courseId) {
                query = query.eq('course_id', courseId);
            }

            const { data, error } = await query;

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching conversations:', error);
            throw error;
        }
    }

    // Get conversation by ID
    static async getConversation(conversationId, userId) {
        try {
            const { data, error } = await supabase
                .from('conversations')
                .select('*')
                .eq('id', conversationId)
                .eq('user_id', userId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching conversation:', error);
            throw error;
        }
    }

    // Add message to conversation
    static async addMessage(conversationId, content, role, metadata = {}) {
        try {
            // Verify conversation exists and user has access
            const conversation = await supabase
                .from('conversations')
                .select('user_id')
                .eq('id', conversationId)
                .single();

            if (!conversation.data) {
                throw new Error('Conversation not found');
            }

            const { data, error } = await supabase
                .from('messages')
                .insert({
                    conversation_id: conversationId,
                    content: content,
                    role: role,
                    metadata: metadata
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error adding message:', error);
            throw error;
        }
    }

    // Get conversation messages
    static async getConversationMessages(conversationId, userId) {
        try {
            // Verify user has access to conversation
            const conversation = await this.getConversation(conversationId, userId);
            if (!conversation) {
                throw new Error('Conversation not found or access denied');
            }

            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching messages:', error);
            throw error;
        }
    }
}

// =============================================
// RECORDING MANAGEMENT
// =============================================

export class SupabaseRecordingService {

    // Create new recording
    static async createRecording(userId, courseId, title, duration) {
        try {
            const { data, error } = await supabase
                .from('recordings')
                .insert({
                    user_id: userId,
                    course_id: courseId,
                    title: title,
                    duration: duration,
                    status: 'processing'
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error creating recording:', error);
            throw error;
        }
    }

    // Update recording with transcription and summary
    static async updateRecording(recordingId, updates) {
        try {
            const { data, error } = await supabase
                .from('recordings')
                .update({
                    ...updates,
                    processed_at: new Date().toISOString()
                })
                .eq('id', recordingId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error updating recording:', error);
            throw error;
        }
    }

    // Get user recordings
    static async getUserRecordings(userId, courseId = null) {
        try {
            let query = supabase
                .from('recording_summary')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (courseId) {
                query = query.eq('course_id', courseId);
            }

            const { data, error } = await query;

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching recordings:', error);
            throw error;
        }
    }

    // Get specific recording
    static async getRecording(recordingId) {
        try {
            const { data, error } = await supabase
                .from('recordings')
                .select('*')
                .eq('id', recordingId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching recording:', error);
            throw error;
        }
    }

    // Delete recording
    static async deleteRecording(recordingId) {
        try {
            const { error } = await supabase
                .from('recordings')
                .delete()
                .eq('id', recordingId);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting recording:', error);
            throw error;
        }
    }
}

// =============================================
// CANVAS DATA CACHE
// =============================================

export class SupabaseCanvasDataService {

    // Cache Canvas data
    static async cacheCanvasData(userId, dataType, courseId, content) {
        try {
            const { data, error } = await supabase
                .from('canvas_data')
                .upsert({
                    user_id: userId,
                    data_type: dataType,
                    course_id: courseId,
                    content: content,
                    last_synced: new Date().toISOString()
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error caching Canvas data:', error);
            throw error;
        }
    }

    // Get cached Canvas data
    static async getCachedCanvasData(userId, dataType, courseId = null) {
        try {
            let query = supabase
                .from('canvas_data')
                .select('*')
                .eq('user_id', userId)
                .eq('data_type', dataType);

            if (courseId) {
                query = query.eq('course_id', courseId);
            }

            const { data, error } = await query;

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching cached Canvas data:', error);
            throw error;
        }
    }

    // Check if data needs refresh (older than 1 hour)
    static async needsRefresh(userId, dataType, courseId = null) {
        try {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

            let query = supabase
                .from('canvas_data')
                .select('last_synced')
                .eq('user_id', userId)
                .eq('data_type', dataType)
                .lt('last_synced', oneHourAgo);

            if (courseId) {
                query = query.eq('course_id', courseId);
            }

            const { data, error } = await query;

            if (error) throw error;
            return data && data.length > 0;
        } catch (error) {
            console.error('Error checking refresh status:', error);
            return true; // Default to refresh on error
        }
    }
}

// =============================================
// STORAGE SERVICE
// =============================================

export class SupabaseStorageService {

    // Upload audio file
    static async uploadAudioFile(userId, recordingId, audioBlob) {
        try {
            const fileName = `${userId}/${recordingId}.webm`;

            const { data, error } = await supabase.storage
                .from('recordings')
                .upload(fileName, audioBlob, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error uploading audio file:', error);
            throw error;
        }
    }

    // Get audio file URL
    static async getAudioFileUrl(userId, recordingId) {
        try {
            const fileName = `${userId}/${recordingId}.webm`;

            const { data } = supabase.storage
                .from('recordings')
                .getPublicUrl(fileName);

            return data.publicUrl;
        } catch (error) {
            console.error('Error getting audio file URL:', error);
            throw error;
        }
    }

    // Delete audio file
    static async deleteAudioFile(userId, recordingId) {
        try {
            const fileName = `${userId}/${recordingId}.webm`;

            const { error } = await supabase.storage
                .from('recordings')
                .remove([fileName]);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting audio file:', error);
            throw error;
        }
    }
}

// Export the main client for direct use if needed
export default supabase; 