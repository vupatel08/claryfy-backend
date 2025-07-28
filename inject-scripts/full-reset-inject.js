import weaviate from 'weaviate-ts-client';
import { FileProcessingService } from './services/fileProcessing.js';
import { CanvasClient } from './build/client.js';
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

const USER_ID = '297da102-dbde-47a2-bba8-f11dcb00e99e'; // your current user
const CANVAS_TOKEN = '1133~zauQ4cJeDNPVJmxRKh2HMDxPCkzQLx8mExLCZRB6c897FaP3W9M7n2CX8MCRC64m';
const CANVAS_DOMAIN = 'umd.instructure.com';

async function fullResetAndInject() {
    try {
        const canvasClient = new CanvasClient(CANVAS_TOKEN, CANVAS_DOMAIN);

        // 1. Delete all CanvasContent objects for the user
        console.log('🗑️ Deleting all CanvasContent objects for user...');
        await weaviateClient.batch.objectsBatchDeleter()
            .withClassName('CanvasContent')
            .withWhere({
                operator: 'Equal',
                path: ['userId'],
                valueString: USER_ID
            })
            .do();
        console.log('✅ All CanvasContent objects deleted.');

        // 2. Get favorite courses from dashboard
        console.log('📚 Fetching favorite courses...');
        const dashboardCards = await canvasClient.getDashboardCards();
        console.log(`Found ${dashboardCards.length} favorite courses.`);

        // 3. Process all content types in parallel for each favorite course
        for (const course of dashboardCards) {
            console.log(`\n🎓 Processing favorite course: ${course.shortName || course.originalName} (${course.id})`);

            try {
                // Process files, assignments, and announcements in parallel
                await Promise.all([
                    // Process PDFs
                    (async () => {
                        try {
                            const files = await canvasClient.listFiles(course.id);
                            const pdfs = files.filter(f => (f.display_name || f.filename || '').toLowerCase().endsWith('.pdf'));
                            console.log(`Found ${pdfs.length} PDFs in course ${course.id}`);

                            for (const file of pdfs) {
                                try {
                                    const freshFile = await canvasClient.getFile(file.id);
                                    const downloadUrl = freshFile.url;
                                    console.log(`\n[${file.display_name}] Downloading PDF from: ${downloadUrl}`);
                                    const pdfData = await FileProcessingService.processPDF(downloadUrl, {
                                        canvasToken: CANVAS_TOKEN
                                    });
                                    if (!pdfData.content || pdfData.content.trim().length === 0) {
                                        console.error(`❌ [${file.display_name}] PDF extraction failed or empty! Skipping.`);
                                        continue;
                                    }
                                    const fileData = {
                                        content: pdfData.content,
                                        title: file.display_name,
                                        type: 'file',
                                        courseId: course.id,
                                        userId: USER_ID,
                                        canvasId: file.id.toString(),
                                        metadata: {
                                            filename: file.filename,
                                            contentType: file.content_type,
                                            size: file.size,
                                            url: file.url
                                        }
                                    };
                                    await weaviateClient.data
                                        .creator()
                                        .withClassName('CanvasContent')
                                        .withProperties(fileData)
                                        .do();
                                    console.log(`✅ [${file.display_name}] Injected with real content.`);
                                } catch (err) {
                                    console.error(`❌ [${file.display_name}] Error processing:`, err);
                                }
                            }
                        } catch (err) {
                            console.error(`❌ Error processing files for course ${course.id}:`, err);
                        }
                    })(),

                    // Process Assignments
                    (async () => {
                        try {
                            const assignments = await canvasClient.listAssignments(course.id);
                            console.log(`[${course.shortName || course.originalName}] Found ${assignments.length} assignments`);
                            if (assignments.length > 0) {
                                assignments.forEach(a => console.log(`  - Assignment: ${a.name}`));
                            }
                            console.log(`Found ${assignments.length} assignments in course ${course.id}`);

                            for (const assignment of assignments) {
                                try {
                                    const assignmentData = {
                                        content: assignment.description || '',
                                        title: assignment.name,
                                        type: 'assignment',
                                        courseId: course.id,
                                        userId: USER_ID,
                                        canvasId: assignment.id.toString(),
                                        metadata: {
                                            dueAt: assignment.due_at,
                                            pointsPossible: assignment.points_possible,
                                            submissionTypes: assignment.submission_types,
                                            url: assignment.html_url
                                        }
                                    };
                                    await weaviateClient.data
                                        .creator()
                                        .withClassName('CanvasContent')
                                        .withProperties(assignmentData)
                                        .do();
                                    console.log(`✅ [${assignment.name}] Assignment injected.`);
                                } catch (err) {
                                    console.error(`❌ [${assignment.name}] Error processing assignment:`, err);
                                }
                            }
                        } catch (err) {
                            console.error(`❌ Error processing assignments for course ${course.id}:`, err);
                        }
                    })(),

                    // Process Announcements using the working approach from test-announcements-inject.js
                    (async () => {
                        try {
                            // Use the course-specific discussion_topics endpoint for announcements
                            const response = await canvasClient.client.get(`/courses/${course.id}/discussion_topics`, {
                                params: {
                                    only_announcements: true,
                                    include: ['assignment']
                                }
                            });

                            const announcements = response.data || [];
                            console.log(`[${course.shortName || course.originalName}] Found ${announcements.length} announcements`);
                            if (announcements.length > 0) {
                                announcements.forEach(a => console.log(`  - Announcement: ${a.title}`));
                            }

                            for (const announcement of announcements) {
                                try {
                                    const announcementData = {
                                        content: announcement.message || '',
                                        title: announcement.title,
                                        type: 'announcement',
                                        courseId: course.id,
                                        userId: USER_ID,
                                        canvasId: announcement.id.toString(),
                                        metadata: {
                                            postedAt: announcement.posted_at,
                                            lastReplyAt: announcement.last_reply_at,
                                            url: announcement.html_url
                                        }
                                    };
                                    await weaviateClient.data
                                        .creator()
                                        .withClassName('CanvasContent')
                                        .withProperties(announcementData)
                                        .do();
                                    console.log(`✅ [${announcement.title}] Announcement injected.`);
                                } catch (err) {
                                    console.error(`❌ [${announcement.title}] Error processing announcement:`, err);
                                }
                            }
                        } catch (err) {
                            console.error(`❌ Error processing announcements for course ${course.id}:`, err);
                        }
                    })()
                ]);
            } catch (err) {
                console.error(`❌ Error processing course ${course.id}:`, err);
            }
        }

        console.log('\n✅ All content types injected successfully!');
    } catch (error) {
        console.error('❌ Error in full reset and inject:', error);
    }
}

fullResetAndInject(); 