#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { CanvasClient } from './build/client.js';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
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

// Get all dashboard data with optimized performance
app.get('/api/dashboard', async (req, res) => {
    if (!canvasClient) {
        return res.status(401).json({ error: 'Not authenticated' });
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

// Serve test files
app.get('/test-canvas-files.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-canvas-files.html'));
});

app.get('/test-pdf.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-pdf.html'));
});

startServer(); 