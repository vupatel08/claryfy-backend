import { CanvasClient } from './build/client.js';
import weaviate from 'weaviate-ts-client';
import dotenv from 'dotenv';

dotenv.config();

const USER_ID = '297da102-dbde-47a2-bba8-f11dcb00e99e';
const CANVAS_TOKEN = '1133~zauQ4cJeDNPVJmxRKh2HMDxPCkzQLx8mExLCZRB6c897FaP3W9M7n2CX8MCRC64m';
const CANVAS_DOMAIN = 'umd.instructure.com';

// Initialize Weaviate client exactly like in full-reset-inject.js
const weaviateClient = weaviate.client({
    scheme: 'https',
    host: process.env.WEAVIATE_URL.replace('https://', ''),
    apiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
    headers: {
        'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY,
    },
});

async function testAnnouncementsInject() {
    try {
        const canvasClient = new CanvasClient(CANVAS_TOKEN, CANVAS_DOMAIN);
        console.log('📚 Fetching favorite courses...');
        const dashboardCards = await canvasClient.getDashboardCards();
        console.log(`Found ${dashboardCards.length} favorite courses.`);

        let totalInjected = 0;

        for (const course of dashboardCards) {
            console.log(`\n=== ${course.shortName || course.originalName} (${course.id}) ===`);
            try {
                // Use the course-specific discussion_topics endpoint for announcements
                const response = await canvasClient.client.get(`/courses/${course.id}/discussion_topics`, {
                    params: {
                        only_announcements: true,
                        include: ['assignment']
                    }
                });

                const announcements = response.data || [];
                console.log(`Found ${announcements.length} announcements.`);

                if (announcements.length > 0) {
                    // Process and inject each announcement
                    for (const a of announcements) {
                        console.log(`\n- Processing: ${a.title}`);

                        const announcementData = {
                            content: a.message || '',
                            title: a.title,
                            type: 'announcement',
                            courseId: course.id,
                            userId: USER_ID,
                            canvasId: a.id.toString(),
                            metadata: {
                                postedAt: a.posted_at,
                                lastReplyAt: a.last_reply_at,
                                url: a.html_url
                            }
                        };

                        try {
                            // Add to Weaviate using the same client as full-reset-inject.js
                            await weaviateClient.data
                                .creator()
                                .withClassName('CanvasContent')
                                .withProperties(announcementData)
                                .do();

                            console.log('  ✅ Successfully injected into Weaviate');
                            totalInjected++;
                        } catch (err) {
                            console.error('  ❌ Error injecting into Weaviate:', err.message);
                        }
                    }
                } else {
                    console.log('No announcements found for this course.');
                }
            } catch (err) {
                console.error(`❌ Error fetching announcements for course ${course.id}:`, err);
            }
        }

        console.log(`\n✅ Injection complete! Added ${totalInjected} announcements to Weaviate.`);
    } catch (error) {
        console.error('❌ Error in test announcements inject:', error);
    }
}

testAnnouncementsInject(); 