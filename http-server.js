#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { CanvasClient } from './build/client.js';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import { OpenAIChatService, OpenAIRAGService } from './services/openai.js';
import { supabase, SupabaseUserService, SupabaseConversationService } from './services/supabase.js';
import { weaviateClient, WeaviateManagementService } from './services/weaviate.js';
import multer from 'multer';
import fs from 'fs';
import weaviate from 'weaviate-client';
import {QueryAgent} from 'weaviate-agents';
// Load environment variables
dotenv.config();




const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const client = await weaviate.connectToWeaviateCloud(process.env.WEAVIATE_URL, {
    authCredentials: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    headers: {
        "X-INFERENCE-PROVIDER-API-KEY": process.env.OPENAI_API_KEY,
    }
});
const qa = new QueryAgent(client, {
    collections: ['CanvasContent'], 
    systemPrompt: `You are a helpful assistant that can answer questions about the user's Canvas content. 
                     If some content is not available in any of the user's data, you can tell them "None of your course data seems to answer your question."
                     If there are sources in the user data, answer their question using the sources and also give them a link to it, or the file name.`,
});



const app = express();
const port = process.env.PORT || 3000;

// Whitelist of allowed origins
const allowedOrigins = [
    'https://claryfy-frontend.vercel.app',
    'http://localhost:3001', // For local frontend development
    'https://mozilla.github.io', // For PDF.js viewer
    // New domain useclaryfy.com
    'https://useclaryfy.com',
    'http://useclaryfy.com',
    'https://www.useclaryfy.com',
    'http://www.useclaryfy.com'
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};

// Enable CORS with dynamic origin and pre-flight handling
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage for Canvas authentication
let userToken = null;
let userDomain = null;
let canvasClient = null;

// No local file caching - serve directly from Canvas

// Performance configuration
const PERFORMANCE_CONFIG = {
    MAX_CONCURRENT_REQUESTS: 12,  // Optimal for most Canvas instances
    COURSE_BATCH_SIZE: 10,        // Process 10 courses at a time
    REQUEST_DELAY: 50,            // 50ms delay between batches
    TIMEOUT_MS: 30000,            // 30 second timeout
    MAX_COURSES: 15               // Limit total courses processed
};

// Performance monitoring
let performanceMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    lastResetTime: Date.now()
};

// Initialize Canvas client
function initializeClient(token, domain) {
    try {
        canvasClient = new CanvasClient(token, domain);
        userToken = token;
        userDomain = domain;
        return true;
    } catch (error) {
        console.error('Failed to initialize Canvas client:', error);
        return false;
    }
}

// Utility function for controlled concurrency
async function processWithConcurrency(items, processor, maxConcurrency = PERFORMANCE_CONFIG.MAX_CONCURRENT_REQUESTS) {
    const results = [];
    const executing = [];

    for (const item of items) {
        const promise = processor(item).then(result => {
            const index = executing.indexOf(promise);
            if (index !== -1) executing.splice(index, 1);
            return result;
        });

        results.push(promise);
        executing.push(promise);

        if (executing.length >= maxConcurrency) {
            await Promise.race(executing);
        }
    }

    return Promise.allSettled(results);
}

// Enhanced batch processing with retries
async function processBatchWithRetry(items, processor, batchSize = PERFORMANCE_CONFIG.COURSE_BATCH_SIZE) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }

    const allResults = [];

    for (const batch of batches) {
        const startTime = Date.now();

        try {
            const batchResults = await processWithConcurrency(batch, processor);
            allResults.push(...batchResults);

            // Small delay between batches to be respectful to Canvas
            if (batches.indexOf(batch) < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.REQUEST_DELAY));
            }

            // Update performance metrics
            const responseTime = Date.now() - startTime;
            performanceMetrics.totalRequests += batch.length;
            performanceMetrics.successfulRequests += batchResults.filter(r => r.status === 'fulfilled').length;
            performanceMetrics.failedRequests += batchResults.filter(r => r.status === 'rejected').length;

        } catch (error) {
            console.error('Batch processing error:', error);
            performanceMetrics.failedRequests += batch.length;
        }
    }

    return allResults;
}

// Configure multer for temporary file storage
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files are allowed'), false);
        }
    },
    filename: (req, file, cb) => {
        // Ensure correct file extension for OpenAI
        const ext = file.mimetype.includes('webm') ? '.webm' : '.wav';
        cb(null, `recording-${Date.now()}${ext}`);
    }
});

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Performance metrics endpoint
app.get('/api/performance', (req, res) => {
    const uptime = Date.now() - performanceMetrics.lastResetTime;
    res.json({
        ...performanceMetrics,
        uptime,
        requestsPerSecond: performanceMetrics.totalRequests / (uptime / 1000),
        successRate: performanceMetrics.totalRequests > 0
            ? (performanceMetrics.successfulRequests / performanceMetrics.totalRequests * 100).toFixed(2) + '%'
            : '0%'
    });
});

// Authentication endpoint
app.post('/auth', async (req, res) => {
    const { token, domain } = req.body;

    if (!token || !domain) {
        return res.status(400).json({ error: 'Token and domain are required' });
    }

    try {
        // Test the connection
        const testClient = new CanvasClient(token, domain);
        const health = await testClient.healthCheck();

        if (health.status === 'ok') {
            initializeClient(token, domain);
            res.json({ success: true, message: 'Authentication successful' });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(401).json({ error: 'Authentication failed: ' + error.message });
    }
});

// Check authentication status
app.get('/auth/status', (req, res) => {
    res.json({
        authenticated: !!canvasClient,
        domain: userDomain
    });
});

// Simple file serving - directly from Canvas (no local caching)
app.get('/api/files/serve/:fileId', async (req, res) => {
    try {
        const fileId = parseInt(req.params.fileId);
        if (isNaN(fileId) || !canvasClient) {
            return res.status(400).json({ error: 'Invalid file ID or not authenticated' });
        }

        // Get file info from Canvas API
        const fileInfo = await canvasClient.getFile(fileId);
        if (!fileInfo || !fileInfo.url) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Fetch file from Canvas with authentication
        const response = await fetch(fileInfo.url, {
            headers: {
                'Authorization': `Bearer ${userToken}`
            }
        });
        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch file from Canvas' });
        }

        // Set appropriate headers
        res.setHeader('Content-Type', fileInfo.content_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${fileInfo.display_name}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Stream the file
        response.body.pipe(res);

    } catch (error) {
        console.error('Error serving file:', error);
        res.status(500).json({ error: 'Failed to serve file' });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    if (!canvasClient) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const health = await canvasClient.healthCheck();
        res.json(health);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get courses
app.get('/api/courses', async (req, res) => {
    if (!canvasClient) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const courses = await canvasClient.listCourses();
        res.json(courses);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get favorite courses (dashboard cards)
app.get('/api/courses/favorites', async (req, res) => {
    if (!canvasClient) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const dashboardCards = await canvasClient.getDashboardCards();

        // Only return essential course information
        const courses = dashboardCards.map(card => ({
            id: card.id,
            name: card.shortName || card.originalName,
            course_code: card.courseCode,
            enrollments: card.enrollments,
            term: card.term,
            href: card.href
        }));

        res.json(courses);
    } catch (error) {
        console.error('Failed to fetch dashboard cards:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Canvas user profile
app.get('/api/profile', async (req, res) => {
    // Check if token and domain are provided for authentication
    const { token, domain } = req.query;

    // If token and domain provided, try to authenticate first
    if (token && domain && (!canvasClient || userToken !== token || userDomain !== domain)) {
        try {
            console.log('🔑 Auto-authenticating with Canvas for profile...');
            const testClient = new CanvasClient(token, domain);
            const health = await testClient.healthCheck();

            if (health.status === 'ok') {
                initializeClient(token, domain);
                console.log('✅ Auto-authentication successful for profile');
            } else {
                return res.status(401).json({ error: 'Invalid Canvas credentials' });
            }
        } catch (error) {
            console.error('Profile auto-authentication failed:', error);
            return res.status(401).json({ error: 'Authentication failed: ' + error.message });
        }
    }

    if (!canvasClient) {
        return res.status(401).json({ error: 'Not authenticated. Please provide token and domain parameters.' });
    }

    try {
        console.log('👤 Fetching Canvas user profile...');
        const profile = await canvasClient.getUserProfile();

        console.log('✅ Canvas profile fetched:', profile.name);
        res.json(profile);
    } catch (error) {
        console.error('❌ Error fetching Canvas profile:', error.message);
        res.status(500).json({
            error: 'Failed to fetch Canvas profile',
            details: error.message
        });
    }
});

// Get all dashboard data with optimized performance
app.get('/api/dashboard', async (req, res) => {
    // Check if token and domain are provided for auto-authentication
    const { token, domain } = req.query;

    // If token and domain provided, try to authenticate first
    if (token && domain && (!canvasClient || userToken !== token || userDomain !== domain)) {
        try {
            console.log('🔑 Auto-authenticating with Canvas...');
            const testClient = new CanvasClient(token, domain);
            const health = await testClient.healthCheck();

            if (health.status === 'ok') {
                initializeClient(token, domain);
                console.log('✅ Auto-authentication successful');
            } else {
                return res.status(401).json({ error: 'Invalid Canvas credentials' });
            }
        } catch (error) {
            console.error('Auto-authentication failed:', error);
            return res.status(401).json({ error: 'Authentication failed: ' + error.message });
        }
    }

    if (!canvasClient) {
        return res.status(401).json({ error: 'Not authenticated. Please provide token and domain parameters.' });
    }

    try {
        console.log('🚀 Starting optimized dashboard data fetch...');
        const startTime = Date.now();

        // Get dashboard cards first
        const dashboardCards = await canvasClient.getDashboardCards();
        console.log(`📊 Dashboard cards: ${dashboardCards.length} courses in ${Date.now() - startTime}ms`);

        // Limit to reasonable number of courses for performance
        const limitedCards = dashboardCards.slice(0, PERFORMANCE_CONFIG.MAX_COURSES);

        // Fetch all data types in parallel
        const [assignments, announcements, files] = await Promise.all([
            getAllAssignmentsOptimized(limitedCards),
            getAllAnnouncementsOptimized(limitedCards),
            getAllFilesOptimized(limitedCards)
        ]);

        const totalTime = Date.now() - startTime;
        console.log(`✅ Dashboard fetch completed in ${totalTime}ms`);

        res.json({
            courses: limitedCards,
            assignments: assignments.slice(0, 50), // Limit to 50 recent assignments
            announcements: announcements.slice(0, 30), // Limit to 30 recent announcements
            files: files.slice(0, 100), // Limit to 100 recent files
            performance: {
                totalTime,
                coursesProcessed: limitedCards.length,
                assignmentsCount: assignments.length,
                announcementsCount: announcements.length,
                filesCount: files.length
            }
        });

    } catch (error) {
        console.error('Dashboard fetch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Optimized assignments fetch
async function getAllAssignmentsOptimized(dashboardCards) {
    const startTime = Date.now();

    if (dashboardCards.length === 0) {
        return [];
    }

    try {
        const assignmentProcessor = async (course) => {
            try {
                const assignments = await canvasClient.listAssignments(course.id);
                if (Array.isArray(assignments)) {
                    return assignments.map(assignment => ({
                        ...assignment,
                        course_id: course.id,
                        course_name: course.shortName || course.originalName
                    }));
                }
                return [];
            } catch (error) {
                console.error(`Error fetching assignments for course ${course.id}:`, error);
                return [];
            }
        };

        const results = await processBatchWithRetry(dashboardCards, assignmentProcessor);
        const allAssignments = results
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value);

        // Sort by due date (most urgent first)
        allAssignments.sort((a, b) => {
            const aDate = new Date(a.due_at || '9999-12-31');
            const bDate = new Date(b.due_at || '9999-12-31');
            return aDate - bDate;
        });

        console.log(`Assignments: ${allAssignments.length} items in ${Date.now() - startTime}ms`);
        return allAssignments;

    } catch (error) {
        console.error('Failed to fetch assignments, using fallback method:', error);

        // Fallback: fetch fewer courses with simpler approach
        const limitedCourses = dashboardCards.slice(0, 5);
        const assignmentProcessor = async (course) => {
            try {
                const assignments = await canvasClient.listAssignments(course.id);
                return Array.isArray(assignments) ? assignments.map(assignment => ({
                    ...assignment,
                    course_id: course.id,
                    course_name: course.shortName || course.originalName
                })) : [];
            } catch (error) {
                console.error(`Error fetching assignments for course ${course.id}:`, error);
                return [];
            }
        };

        const results = await processBatchWithRetry(limitedCourses, assignmentProcessor);
        const allAssignments = results
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value);

        allAssignments.sort((a, b) => {
            const aDate = new Date(a.due_at || '9999-12-31');
            const bDate = new Date(b.due_at || '9999-12-31');
            return aDate - bDate;
        });

        console.log(`Assignments (fallback): ${allAssignments.length} items in ${Date.now() - startTime}ms`);
        return allAssignments;
    }
}

async function getAllAnnouncementsOptimized(dashboardCards) {
    const startTime = Date.now();

    if (dashboardCards.length === 0) {
        return [];
    }

    try {
        const announcementProcessor = async (course) => {
            try {
                // Use the course-specific discussion_topics endpoint for announcements
                const response = await canvasClient.client.get(`/courses/${course.id}/discussion_topics`, {
                    params: {
                        only_announcements: true,
                        include: ['assignment']
                    }
                });

                const announcements = response.data || [];
                return announcements.map(announcement => ({
                    ...announcement,
                    course_id: course.id,
                    course_name: course.shortName || course.originalName
                }));
            } catch (error) {
                console.error(`Error fetching announcements for course ${course.id}:`, error);
                return [];
            }
        };

        const results = await processBatchWithRetry(dashboardCards, announcementProcessor);
        const allAnnouncements = results
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value);

        allAnnouncements.sort((a, b) => {
            return new Date(b.posted_at || b.created_at) - new Date(a.posted_at || a.created_at);
        });

        console.log(`Announcements: ${allAnnouncements.length} items in ${Date.now() - startTime}ms`);
        return allAnnouncements;

    } catch (error) {
        console.error('Failed to fetch announcements, using fallback method:', error);

        // Fallback: fetch fewer courses
        const limitedCourses = dashboardCards.slice(0, 5);
        const announcementProcessor = async (course) => {
            try {
                const response = await canvasClient.client.get(`/courses/${course.id}/discussion_topics`, {
                    params: {
                        only_announcements: true,
                        include: ['assignment']
                    }
                });

                const announcements = response.data || [];
                return announcements.map(announcement => ({
                    ...announcement,
                    course_id: course.id,
                    course_name: course.shortName || course.originalName
                }));
            } catch (error) {
                console.error(`Error fetching announcements for course ${course.id}:`, error);
                return [];
            }
        };

        const results = await processBatchWithRetry(limitedCourses, announcementProcessor);
        const allAnnouncements = results
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value);

        allAnnouncements.sort((a, b) => {
            return new Date(b.posted_at || b.created_at) - new Date(a.posted_at || a.created_at);
        });

        console.log(`Announcements (fallback): ${allAnnouncements.length} items in ${Date.now() - startTime}ms`);
        return allAnnouncements;
    }
}

async function getAllFilesOptimized(dashboardCards) {
    const startTime = Date.now();

    // Limit files to fewer courses since they're often large and less critical
    const limitedCourses = dashboardCards.slice(0, Math.min(8, dashboardCards.length));

    const fileProcessor = async (course) => {
        try {
            const files = await canvasClient.listFiles(course.id);
            if (Array.isArray(files)) {
                // Return files with course info but without downloading them
                return files.map(file => ({
                    ...file,
                    course_id: course.id,
                    course_name: course.shortName || course.originalName
                }));
            }
            return [];
        } catch (error) {
            console.error(`Error fetching files for course ${course.id}:`, error);
            return [];
        }
    };

    const results = await processBatchWithRetry(limitedCourses, fileProcessor);
    const allFiles = results
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value);

    allFiles.sort((a, b) => {
        return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
    });

    console.log(`Files: ${allFiles.length} items in ${Date.now() - startTime}ms (${limitedCourses.length} courses)`);
    return allFiles;
}

// Logout
app.post('/logout', (req, res) => {
    canvasClient = null;
    userToken = null;
    userDomain = null;
    // Reset performance metrics
    performanceMetrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        lastResetTime: Date.now()
    };
    res.json({ success: true, message: 'Logged out successfully' });
});

// Serve test files
app.get('/test-canvas-files.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-canvas-files.html'));
});

app.get('/test-pdf.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-pdf.html'));
});

// Enhanced chat endpoint with Gemini query processing and Supabase history
app.post('/api/chat', async (req, res) => {
    try {
        const { message, userId, courseId, conversationId } = req.body;

        if (!message || !userId) {
            return res.status(400).json({ error: 'Message and userId are required' });
        }

        // Use Weaviate Query Agent instead of custom RAG
        const response = await qa.run(message);

        // You can format the response as needed for your frontend
        res.json({
            response: response.finalAnswer || response.response,
            originalQuery: response.originalQuery,
            searches: response.searches,
            aggregations: response.aggregations,
            missingInformation: response.missingInformation,
        });

        // Save and vectorize in the background (non-blocking)
        (async () => {
            try {
                const { ConversationService } = await import('./services/conversation.js');
                let convId = conversationId;
                if (!convId) {
                    // Generate a title or use a default
                    const title = message.slice(0, 40) || 'New Conversation';
                    const conversation = await ConversationService.getOrCreateConversation(userId, title, courseId);
                    convId = conversation.id;
                }
                await ConversationService.addMessage(convId, message, 'user');
                await ConversationService.addMessage(convId, response.finalAnswer || response.response, 'assistant');
                const allMessages = await ConversationService.getConversationMessages(convId, userId);
                const { WeaviateChatService } = await import('./services/weaviate.js');
                await WeaviateChatService.vectorizeConversation(
                    userId,
                    convId,
                    allMessages,
                    courseId
                );
            } catch (err) {
                console.error('Error saving/vectorizing chat:', err);
            }
        })();

    } catch (error) {
        console.error('Weaviate Query Agent error:', error);
        res.status(500).json({ error: 'Failed to process chat message: ' + error.message });
    }
});

// Get chat history
app.get('/api/chat/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { courseId } = req.query;

        const conversations = await SupabaseConversationService.getUserConversations(userId, courseId);

        res.json({ conversations });
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

// Get conversation messages
app.get('/api/chat/conversation/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { userId } = req.query; // Get userId from query params

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const messages = await SupabaseConversationService.getConversationMessages(conversationId, userId);

        res.json({ messages });
    } catch (error) {
        console.error('Error fetching conversation messages:', error);
        res.status(500).json({ error: 'Failed to fetch conversation messages' });
    }
});

// Create new conversation
app.post('/api/chat/conversation', async (req, res) => {
    try {
        const { userId, courseId, title } = req.body;

        if (!userId || !title) {
            return res.status(400).json({ error: 'UserId and title are required' });
        }

        const conversation = await SupabaseConversationService.createConversation(userId, courseId, title);

        res.json({ conversation });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
    }
});

// Simple chat endpoint that only uses OpenAI
app.post('/api/chat/simple', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Create a simple message array with just the user's message
        const messages = [
            {
                role: 'system',
                content: 'You are a helpful AI assistant.'
            },
            {
                role: 'user',
                content: message
            }
        ];

        // Get response from OpenAI
        const response = await OpenAIChatService.generateChatResponse(messages);

        // Format and send the response
        res.json({
            response: response.choices[0].message.content,
            messageId: response.id
        });

    } catch (error) {
        console.error('Error in chat:', error);
        res.status(500).json({ error: 'Failed to get response from AI' });
    }
});

// ==============================================
// PHASE 4: WEAVIATE VECTOR DATABASE ENDPOINTS
// ==============================================

// Weaviate health check
app.get('/api/weaviate/health', async (req, res) => {
    try {
        const health = await WeaviateManagementService.healthCheck();
        res.json(health);
    } catch (error) {
        console.error('Weaviate health check error:', error);
        res.status(500).json({ error: 'Weaviate health check failed' });
    }
});

// Get Weaviate schema info
app.get('/api/weaviate/schema', async (req, res) => {
    try {
        const schema = await WeaviateManagementService.getSchemaInfo();
        res.json(schema);
    } catch (error) {
        console.error('Error getting Weaviate schema:', error);
        res.status(500).json({ error: 'Failed to get schema info' });
    }
});

// Vectorize Canvas data for a user
app.post('/api/weaviate/vectorize/canvas', async (req, res) => {
    try {
        const { userId, canvasData } = req.body;

        if (!userId || !canvasData) {
            return res.status(400).json({ error: 'UserId and canvasData are required' });
        }

        // Import the Canvas vectorization service
        const { WeaviateCanvasService } = await import('./services/weaviate.js');

        const results = await WeaviateCanvasService.vectorizeAllCanvasData(userId, canvasData);

        res.json({
            success: true,
            vectorized: results,
            message: 'Canvas data vectorized successfully'
        });

    } catch (error) {
        console.error('Error vectorizing Canvas data:', error);
        res.status(500).json({ error: 'Failed to vectorize Canvas data: ' + error.message });
    }
});

// Search Canvas content
app.post('/api/weaviate/search/canvas', async (req, res) => {
    try {
        const { query, userId, courseId, limit = 5 } = req.body;

        if (!query || !userId) {
            return res.status(400).json({ error: 'Query and userId are required' });
        }

        // Import the search service
        const { WeaviateSearchService } = await import('./services/weaviate.js');

        const results = await WeaviateSearchService.searchCanvasContent(query, userId, courseId, limit);

        res.json({
            results,
            query,
            count: results.length
        });

    } catch (error) {
        console.error('Error searching Canvas content:', error);
        res.status(500).json({ error: 'Failed to search Canvas content: ' + error.message });
    }
});

// Search all content (Canvas + chat history + recordings)
app.post('/api/weaviate/search/all', async (req, res) => {
    try {
        const { query, userId, courseId } = req.body;

        if (!query || !userId) {
            return res.status(400).json({ error: 'Query and userId are required' });
        }

        // Import the search service
        const { WeaviateSearchService } = await import('./services/weaviate.js');

        const results = await WeaviateSearchService.searchAllContent(query, userId, courseId);

        res.json({
            results,
            query,
            breakdown: {
                canvasContent: results.canvasContent?.length || 0,
                chatHistory: results.chatHistory?.length || 0,
                recordings: results.recordings?.length || 0
            }
        });

    } catch (error) {
        console.error('Error searching all content:', error);
        res.status(500).json({ error: 'Failed to search all content: ' + error.message });
    }
});

// Vectorize a conversation
app.post('/api/weaviate/vectorize/conversation', async (req, res) => {
    try {
        const { userId, conversationId, messages, courseId } = req.body;

        if (!userId || !conversationId || !messages) {
            return res.status(400).json({ error: 'UserId, conversationId, and messages are required' });
        }

        // Import the chat service
        const { WeaviateChatService } = await import('./services/weaviate.js');

        const result = await WeaviateChatService.vectorizeConversation(userId, conversationId, messages, courseId);

        res.json({
            success: true,
            vectorized: result,
            message: 'Conversation vectorized successfully'
        });

    } catch (error) {
        console.error('Error vectorizing conversation:', error);
        res.status(500).json({ error: 'Failed to vectorize conversation: ' + error.message });
    }
});

// Clear user's vector data
app.delete('/api/weaviate/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'UserId is required' });
        }

        // Import the Canvas service
        const { WeaviateCanvasService } = await import('./services/weaviate.js');

        const result = await WeaviateCanvasService.clearUserData(userId);

        res.json({
            success: true,
            cleared: result,
            message: 'User vector data cleared successfully'
        });

    } catch (error) {
        console.error('Error clearing user data:', error);
        res.status(500).json({ error: 'Failed to clear user data: ' + error.message });
    }
});

// Data sync pipeline - automatically vectorize Canvas data after fetching
app.post('/api/weaviate/sync/canvas', async (req, res) => {
    try {
        const { userId, token, domain } = req.body;

        if (!userId || !token || !domain) {
            return res.status(400).json({ error: 'UserId, token, and domain are required' });
        }

        console.log(`🔄 Starting Canvas data sync and vectorization for user ${userId}...`);

        // Initialize Canvas client for this request
        const tempClient = new CanvasClient(token, domain);

        // Temporarily set the global client for the helper functions
        const originalClient = canvasClient;
        canvasClient = tempClient;

        try {
            // Fetch Canvas data
            console.log('📡 Fetching Canvas data...');
            const dashboardCards = await tempClient.getDashboardCards();

            // Limit courses for better performance
            const limitedCourses = dashboardCards.slice(0, PERFORMANCE_CONFIG.MAX_COURSES);

            // Get all Canvas content
            const [assignmentsResult, announcementsResult, filesResult] = await Promise.allSettled([
                getAllAssignmentsOptimized(limitedCourses),
                getAllAnnouncementsOptimized(limitedCourses),
                getAllFilesOptimized(limitedCourses)
            ]);

            const canvasData = {
                courses: limitedCourses,
                assignments: assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : [],
                announcements: announcementsResult.status === 'fulfilled' ? announcementsResult.value : [],
                files: filesResult.status === 'fulfilled' ? filesResult.value : []
            };

            console.log(`📊 Fetched Canvas data: ${canvasData.courses.length} courses, ${canvasData.assignments.length} assignments, ${canvasData.announcements.length} announcements, ${canvasData.files.length} files`);

            // Vectorize the Canvas data
            console.log('🔍 Vectorizing Canvas data...');
            const { WeaviateCanvasService } = await import('./services/weaviate.js');
            const vectorizationResults = await WeaviateCanvasService.vectorizeAllCanvasData(userId, canvasData);

            res.json({
                success: true,
                canvasData: {
                    courses: canvasData.courses.length,
                    assignments: canvasData.assignments.length,
                    announcements: canvasData.announcements.length,
                    files: canvasData.files.length
                },
                vectorizationResults,
                message: 'Canvas data synced and vectorized successfully'
            });

        } finally {
            // Restore the original client
            canvasClient = originalClient;
        }

    } catch (error) {
        console.error('Error syncing Canvas data:', error);
        res.status(500).json({ error: 'Failed to sync Canvas data: ' + error.message });
    }
});

// Refresh button functionality - sync and vectorize latest Canvas data
app.post('/api/refresh-canvas-data', async (req, res) => {
    try {
        const { userId, token, domain } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'UserId is required' });
        }

        // Use provided credentials or fall back to stored ones
        const useToken = token || userToken;
        const useDomain = domain || userDomain;

        if (!useToken || !useDomain) {
            return res.status(400).json({ error: 'Canvas credentials not available' });
        }

        console.log(`🔄 Refreshing Canvas data for user ${userId}...`);

        // Sync data and vectorize in one call
        const syncResponse = await fetch(`http://localhost:${port}/api/weaviate/sync/canvas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId,
                token: useToken,
                domain: useDomain
            })
        });

        if (!syncResponse.ok) {
            throw new Error('Failed to sync Canvas data');
        }

        const syncResult = await syncResponse.json();

        res.json({
            success: true,
            message: 'Canvas data refreshed and vectorized successfully',
            data: syncResult
        });

    } catch (error) {
        console.error('Error refreshing Canvas data:', error);
        res.status(500).json({ error: 'Failed to refresh Canvas data: ' + error.message });
    }
});

// Streaming chat endpoint that only uses OpenAI
app.post('/api/chat/simple/stream', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Set headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Create a simple message array with just the user's message
        const messages = [
            {
                role: 'system',
                content: 'You are a helpful AI assistant.'
            },
            {
                role: 'user',
                content: message
            }
        ];

        // Get streaming response from OpenAI
        const stream = await OpenAIChatService.generateStreamingChatResponse(messages);

        // Stream the response
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

    } catch (error) {
        console.error('Error in streaming chat:', error);
        res.write(`data: ${JSON.stringify({ error: 'Failed to get response from AI' })}\n\n`);
        res.end();
    }
});

// =============================================
// RECORDING ENDPOINTS
// =============================================

// Get user recordings
app.get('/api/recordings', async (req, res) => {
    try {
        const { userId, courseId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        console.log(`📚 Fetching recordings for user ${userId}${courseId ? ` in course ${courseId}` : ''}`);

        const { SupabaseRecordingService } = await import('./services/supabase.js');
        const recordings = await SupabaseRecordingService.getUserRecordings(userId, courseId || null);

        console.log(`✅ Found ${recordings.length} recordings`);
        res.json(recordings);
    } catch (error) {
        console.error('❌ Error fetching recordings:', error.message);
        res.status(500).json({
            error: 'Failed to fetch recordings',
            details: error.message
        });
    }
});

// Get specific recording details
app.get('/api/recordings/:recordingId', async (req, res) => {
    try {
        const { recordingId } = req.params;

        console.log(`📄 Fetching recording details for ${recordingId}`);

        const { SupabaseRecordingService } = await import('./services/supabase.js');
        const recording = await SupabaseRecordingService.getRecording(recordingId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        console.log(`✅ Recording details fetched: ${recording.title}`);
        res.json(recording);
    } catch (error) {
        console.error('❌ Error fetching recording details:', error.message);
        res.status(500).json({
            error: 'Failed to fetch recording details',
            details: error.message
        });
    }
});

// Process audio recording
app.post('/api/recordings/process', upload.single('audio'), async (req, res) => {
    try {
        const { userId, courseId, recordingId, title, duration } = req.body;
        const audioFile = req.file;

        if (!audioFile || !userId || !courseId || !recordingId) {
            return res.status(400).json({
                error: 'Missing required fields: audio file, userId, courseId, or recordingId'
            });
        }

        console.log(`🎙️ Processing recording ${recordingId} for user ${userId}`);

        // Import services
        const { OpenAIAudioService } = await import('./services/openai.js');
        const { SupabaseRecordingService, SupabaseStorageService } = await import('./services/supabase.js');
        const { WeaviateRecordingService } = await import('./services/weaviate.js');

        let tempFileWithExt = null; // Track temporary file for cleanup

        try {
            // 1. Upload audio to Supabase Storage temporarily
            console.log('📤 Uploading audio to storage...');

            const audioBlob = fs.readFileSync(audioFile.path);
            const storageResult = await SupabaseStorageService.uploadAudioFile(
                userId,
                recordingId,
                audioBlob
            );

            // 2. Transcribe audio with Whisper
            console.log('🎧 Transcribing audio with Whisper...');

            // Determine file extension based on mime type
            const fileExtension = audioFile.mimetype?.includes('webm') ? '.webm' : '.wav';
            tempFileWithExt = audioFile.path + fileExtension;

            // Copy file with proper extension for OpenAI
            fs.copyFileSync(audioFile.path, tempFileWithExt);

            // Create file stream for OpenAI
            const audioFileForWhisper = fs.createReadStream(tempFileWithExt);
            audioFileForWhisper.path = tempFileWithExt;

            console.log(`🎧 Transcribing ${audioFile.mimetype} file with extension ${fileExtension}...`);

            const transcription = await OpenAIAudioService.transcribeAudio(audioFileForWhisper);

            if (!transcription || transcription.length < 10) {
                throw new Error('Transcription too short or empty');
            }

            // 3. Generate summary with OpenAI
            console.log('📝 Generating summary with OpenAI...');

            // Get course info for better context
            let courseInfo = null;
            try {
                // For now, create a simple course info object
                // In future, we could fetch from Canvas API if user token is available
                courseInfo = {
                    id: courseId,
                    name: `Course ${courseId}`,
                    code: `COURSE-${courseId}`
                };
                console.log('✅ Course info created for context');
            } catch (error) {
                console.warn('Could not create course info:', error.message);
            }

            const summary = await OpenAIAudioService.generateLectureSummary(transcription, courseInfo);

            // 4. Update recording in Supabase
            console.log('💾 Saving to database...');

            const updatedRecording = await SupabaseRecordingService.updateRecording(recordingId, {
                transcription: transcription,
                summary: summary,
                status: 'completed',
                audio_url: await SupabaseStorageService.getAudioFileUrl(userId, recordingId)
            });

            // 5. Vectorize in Weaviate
            console.log('🧠 Vectorizing content...');

            try {
                await WeaviateRecordingService.vectorizeRecording(
                    userId,
                    recordingId,
                    title,
                    summary,
                    transcription,
                    parseInt(courseId),
                    parseInt(duration)
                );
                console.log('✅ Recording vectorized successfully');
            } catch (vectorError) {
                console.warn('⚠️ Vectorization failed but continuing:', vectorError.message);
                // Don't fail the entire process if vectorization fails
            }

            // 6. Clean up temporary files
            try {
                fs.unlinkSync(audioFile.path);
                if (tempFileWithExt && tempFileWithExt !== audioFile.path) {
                    fs.unlinkSync(tempFileWithExt);
                }
                console.log('🗑️ Temporary files cleaned up');
            } catch (cleanupError) {
                console.warn('Warning: Could not delete temporary file:', cleanupError.message);
            }

            // 7. Delete audio from storage (keep only transcription and summary)
            try {
                await SupabaseStorageService.deleteAudioFile(userId, recordingId);
                console.log('🗑️ Audio file deleted from storage');
            } catch (deleteError) {
                console.warn('Warning: Could not delete audio file from storage:', deleteError.message);
            }

            console.log('✅ Recording processing completed successfully');

            res.json({
                success: true,
                recording: updatedRecording,
                transcription: transcription,
                summary: summary,
                message: 'Recording processed successfully'
            });

        } catch (processingError) {
            console.error('❌ Error processing recording:', processingError);

            // Update recording status to failed
            try {
                await SupabaseRecordingService.updateRecording(recordingId, {
                    status: 'failed',
                    summary: `Processing failed: ${processingError.message}`
                });
            } catch (updateError) {
                console.error('Error updating recording status:', updateError);
            }

            // Clean up temporary files
            try {
                if (audioFile && audioFile.path) {
                    fs.unlinkSync(audioFile.path);
                }
                if (tempFileWithExt && tempFileWithExt !== audioFile.path) {
                    fs.unlinkSync(tempFileWithExt);
                }
            } catch (cleanupError) {
                console.warn('Could not clean up temporary file:', cleanupError);
            }

            throw processingError;
        }

    } catch (error) {
        console.error('Error in recording processing endpoint:', error);
        res.status(500).json({
            error: 'Failed to process recording: ' + error.message,
            details: error.message
        });
    }
});

// Get user recordings
app.get('/api/recordings/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { courseId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Import service
        const { SupabaseRecordingService } = await import('./services/supabase.js');

        const recordings = await SupabaseRecordingService.getUserRecordings(
            userId,
            courseId ? parseInt(courseId) : null
        );

        res.json({
            recordings,
            count: recordings.length
        });

    } catch (error) {
        console.error('Error fetching user recordings:', error);
        res.status(500).json({ error: 'Failed to fetch recordings: ' + error.message });
    }
});

// Get specific recording details
app.get('/api/recordings/:recordingId', async (req, res) => {
    try {
        const { recordingId } = req.params;

        if (!recordingId) {
            return res.status(400).json({ error: 'Recording ID is required' });
        }

        // Import service
        const { SupabaseRecordingService } = await import('./services/supabase.js');

        const recording = await SupabaseRecordingService.getRecording(recordingId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        res.json(recording);

    } catch (error) {
        console.error('Error fetching recording:', error);
        res.status(500).json({ error: 'Failed to fetch recording: ' + error.message });
    }
});

// Delete recording
app.delete('/api/recordings/:recordingId', async (req, res) => {
    try {
        const { recordingId } = req.params;
        const { userId } = req.body;

        if (!recordingId || !userId) {
            return res.status(400).json({ error: 'Recording ID and User ID are required' });
        }

        // Import services
        const { SupabaseRecordingService, SupabaseStorageService } = await import('./services/supabase.js');

        // Get recording to verify ownership
        const recording = await SupabaseRecordingService.getRecording(recordingId);

        if (!recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        if (recording.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this recording' });
        }

        // Delete from storage if exists
        try {
            await SupabaseStorageService.deleteAudioFile(userId, recordingId);
        } catch (storageError) {
            console.warn('Could not delete audio file from storage:', storageError.message);
        }

        // Delete from database
        await SupabaseRecordingService.deleteRecording(recordingId);

        // TODO: Delete from Weaviate vector database
        // This would require implementing a delete method in WeaviateRecordingService

        res.json({
            success: true,
            message: 'Recording deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting recording:', error);
        res.status(500).json({ error: 'Failed to delete recording: ' + error.message });
    }
});

// Start server
async function startServer() {
    try {
        // Start HTTP server
        app.listen(port, () => {
            console.log(`🚀 Simplified HTTP server running on http://localhost:${port}`);
            console.log(`📊 Performance config: ${PERFORMANCE_CONFIG.MAX_CONCURRENT_REQUESTS} concurrent, ${PERFORMANCE_CONFIG.MAX_COURSES} max courses`);
            console.log(`⚡ Files served directly from Canvas - no caching complexity`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Gracefully shutting down...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Gracefully shutting down...');
    process.exit(0);
});

startServer(); 