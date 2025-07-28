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

async function testAssignmentsInject() {
    try {
        const canvasClient = new CanvasClient(CANVAS_TOKEN, CANVAS_DOMAIN);
        console.log('📚 Fetching favorite courses...');
        const dashboardCards = await canvasClient.getDashboardCards();
        console.log(`Found ${dashboardCards.length} favorite courses.`);

        let totalInjected = 0;

        for (const course of dashboardCards) {
            console.log(`\n=== ${course.shortName || course.originalName} (${course.id}) ===`);
            try {
                const assignments = await canvasClient.listAssignments(course.id);
                console.log(`Found ${assignments.length} assignments.`);

                if (assignments.length > 0) {
                    // Process and inject each assignment
                    for (const assignment of assignments) {
                        console.log(`\n- Processing: ${assignment.name}`);
                        console.log(`  Due: ${assignment.due_at || 'No due date'}`);
                        console.log(`  Points: ${assignment.points_possible || 'Not specified'}`);

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

                        try {
                            // Add to Weaviate using the same client as full-reset-inject.js
                            await weaviateClient.data
                                .creator()
                                .withClassName('CanvasContent')
                                .withProperties(assignmentData)
                                .do();

                            console.log('  ✅ Successfully injected into Weaviate');
                            totalInjected++;
                        } catch (err) {
                            console.error('  ❌ Error injecting into Weaviate:', err.message);
                        }
                    }
                } else {
                    console.log('No assignments found for this course.');
                }
            } catch (err) {
                console.error(`❌ Error fetching assignments for course ${course.id}:`, err);
            }
        }

        console.log(`\n✅ Injection complete! Added ${totalInjected} assignments to Weaviate.`);
    } catch (error) {
        console.error('❌ Error in test assignments inject:', error);
    }
}

testAssignmentsInject(); 