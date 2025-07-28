import weaviate from 'weaviate-ts-client';
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

async function testWeaviateAssignments() {
    try {
        console.log('🔍 Testing Weaviate assignments...\n');

        // Get total count of assignments
        const countResult = await weaviateClient.graphql
            .aggregate()
            .withClassName('CanvasContent')
            .withFields('meta { count }')
            .withWhere({
                operator: 'Equal',
                path: ['type'],
                valueString: 'assignment'
            })
            .do();

        const totalAssignments = countResult.data.Aggregate.CanvasContent[0].meta.count;
        console.log(`Total assignments in Weaviate: ${totalAssignments}\n`);

        if (totalAssignments === 0) {
            console.log('❌ No assignments found in Weaviate.');
            console.log('Run the inject script first to add assignments.');
            return;
        }

        // Get assignments by course using a different approach
        console.log('Assignments per course:');
        const courseResults = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('courseId')
            .withWhere({
                operator: 'Equal',
                path: ['type'],
                valueString: 'assignment'
            })
            .withLimit(1000) // Adjust if you have more assignments
            .do();

        // Count assignments per course
        const courseCounts = {};
        courseResults.data.Get.CanvasContent.forEach(assignment => {
            courseCounts[assignment.courseId] = (courseCounts[assignment.courseId] || 0) + 1;
        });

        Object.entries(courseCounts).forEach(([courseId, count]) => {
            console.log(`- Course ${courseId}: ${count} assignments`);
        });

        // Get sample assignments
        const sampleResult = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title courseId metadata { dueAt pointsPossible url }')
            .withWhere({
                operator: 'Equal',
                path: ['type'],
                valueString: 'assignment'
            })
            .withLimit(5)
            .do();

        console.log('\nSample assignments:\n');
        sampleResult.data.Get.CanvasContent.forEach((assignment, index) => {
            console.log(`[${index + 1}] Course ${assignment.courseId}`);
            console.log(`Title: ${assignment.title}`);
            console.log(`Due At: ${assignment.metadata.dueAt || 'Not specified'}`);
            console.log(`Points: ${assignment.metadata.pointsPossible || 'Not specified'}`);
            console.log();
        });

        // Test specific course (e.g., CMSC422)
        const cmsc422Result = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields('title metadata { dueAt pointsPossible url }')
            .withWhere({
                operator: 'And',
                operands: [
                    {
                        operator: 'Equal',
                        path: ['type'],
                        valueString: 'assignment'
                    },
                    {
                        operator: 'Equal',
                        path: ['courseId'],
                        valueNumber: 1378023 // CMSC422 course ID
                    }
                ]
            })
            .withLimit(10)
            .do();

        console.log('Testing CMSC422 (1378023) specifically:');
        const cmsc422Assignments = cmsc422Result.data.Get.CanvasContent;
        if (cmsc422Assignments.length > 0) {
            console.log(`Found ${cmsc422Assignments.length} assignments for CMSC422:\n`);
            cmsc422Assignments.forEach((assignment, index) => {
                console.log(`[${index + 1}] ${assignment.title}`);
                console.log(`Due At: ${assignment.metadata.dueAt || 'Not specified'}`);
                console.log(`Points: ${assignment.metadata.pointsPossible || 'Not specified'}`);
                console.log();
            });
        } else {
            console.log('No assignments found for CMSC422');
        }

    } catch (error) {
        console.error('❌ Error testing Weaviate assignments:', error);
    }
}

testWeaviateAssignments(); 