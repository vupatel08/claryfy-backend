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

const USER_ID = '297da102-dbde-47a2-bba8-f11dcb00e99e'; // your current user

async function testContentTypes() {
    try {
        console.log('🔍 Testing Weaviate content...\n');

        // Test Assignments
        console.log('📚 Testing Assignments:');
        const assignmentsQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields(`
                title
                content
                type
                courseId
                metadata {
                    dueAt
                    pointsPossible
                    submissionTypes
                    url
                }
                _additional {
                    id
                }
            `)
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'assignment' }
                ]
            })
            .do();

        const assignments = assignmentsQuery.data?.Get?.CanvasContent || [];
        console.log(`Found ${assignments.length} assignments`);

        if (assignments.length > 0) {
            console.log('\nSample Assignment:');
            const sample = assignments[0];
            console.log('- Title:', sample.title);
            console.log('- Has Content:', Boolean(sample.content));
            console.log('- Course ID:', sample.courseId);
            console.log('- Due Date:', sample.metadata?.dueAt || 'Not set');
            console.log('- Points:', sample.metadata?.pointsPossible || 'Not set');
            console.log('- Submission Types:', sample.metadata?.submissionTypes || 'Not set');
        }

        // Test Announcements
        console.log('\n📢 Testing Announcements:');
        const announcementsQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields(`
                title
                content
                type
                courseId
                metadata {
                    postedAt
                    lastReplyAt
                    url
                }
                _additional {
                    id
                }
            `)
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'announcement' }
                ]
            })
            .do();

        const announcements = announcementsQuery.data?.Get?.CanvasContent || [];
        console.log(`Found ${announcements.length} announcements`);

        if (announcements.length > 0) {
            console.log('\nSample Announcement:');
            const sample = announcements[0];
            console.log('- Title:', sample.title);
            console.log('- Has Content:', Boolean(sample.content));
            console.log('- Course ID:', sample.courseId);
            console.log('- Posted At:', sample.metadata?.postedAt || 'Not set');
            console.log('- Last Reply:', sample.metadata?.lastReplyAt || 'Not set');
        }

        // Test Content Distribution
        console.log('\n📊 Content Distribution by Type:');
        const distributionQuery = await weaviateClient.graphql
            .aggregate()
            .withClassName('CanvasContent')
            .withFields('meta { count } type { value } groupedBy { value }')
            .withWhere({
                operator: 'Equal',
                path: ['userId'],
                valueString: USER_ID
            })
            .withGroupBy(['type'])
            .do();

        const distribution = distributionQuery.data?.Aggregate?.CanvasContent || [];
        distribution.forEach(group => {
            console.log(`- ${group.groupedBy.value}: ${group.meta.count} items`);
        });

        // Test Course Distribution
        console.log('\n📊 Content Distribution by Course:');
        const courseDistributionQuery = await weaviateClient.graphql
            .aggregate()
            .withClassName('CanvasContent')
            .withFields('meta { count } courseId { value } groupedBy { value }')
            .withWhere({
                operator: 'Equal',
                path: ['userId'],
                valueString: USER_ID
            })
            .withGroupBy(['courseId'])
            .do();

        const courseDistribution = courseDistributionQuery.data?.Aggregate?.CanvasContent || [];
        courseDistribution.forEach(group => {
            console.log(`- Course ${group.groupedBy.value}: ${group.meta.count} items`);
        });

    } catch (error) {
        console.error('❌ Error testing content:', error);
    }
}

testContentTypes(); 