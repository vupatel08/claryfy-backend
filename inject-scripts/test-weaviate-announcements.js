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

const USER_ID = '297da102-dbde-47a2-bba8-f11dcb00e99e';

async function testWeaviateAnnouncements() {
    try {
        console.log('🔍 Testing Weaviate announcements...\n');

        // 1. Get total count of announcements
        const countQuery = await weaviateClient.graphql
            .aggregate()
            .withClassName('CanvasContent')
            .withFields('meta { count }')
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'announcement' }
                ]
            })
            .do();

        const totalCount = countQuery.data?.Aggregate?.CanvasContent[0]?.meta?.count || 0;
        console.log(`Total announcements in Weaviate: ${totalCount}`);

        if (totalCount === 0) {
            console.log('\n❌ No announcements found in Weaviate.');
            console.log('Run the inject script first to add announcements.');
            return;
        }

        // 2. Get distribution by course
        const courseDistQuery = await weaviateClient.graphql
            .aggregate()
            .withClassName('CanvasContent')
            .withFields('meta { count } groupedBy { value }')  // Fixed: groupBy -> groupedBy
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'announcement' }
                ]
            })
            .withGroupBy(['courseId'])
            .do();

        const courseDistribution = courseDistQuery.data?.Aggregate?.CanvasContent || [];
        console.log('\nAnnouncements per course:');
        courseDistribution.forEach(group => {
            console.log(`- Course ${group.groupedBy.value}: ${group.meta.count} announcements`);
        });

        // 3. Get sample announcements with content
        const contentQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields(`
                title
                content
                courseId
                metadata {
                    postedAt
                    lastReplyAt
                    url
                }
            `)
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'announcement' }
                ]
            })
            .withLimit(5)
            .do();

        const announcements = contentQuery.data?.Get?.CanvasContent || [];
        if (announcements.length > 0) {
            console.log('\nSample announcements:');
            announcements.forEach((a, idx) => {
                console.log(`\n[${idx + 1}] Course ${a.courseId}`);
                console.log(`Title: ${a.title}`);
                console.log(`Posted At: ${a.metadata?.postedAt}`);
                console.log(`Content Preview: ${(a.content || '').slice(0, 150)}...`);
            });
        }

        // 4. Test specific course (e.g., BMGT395)
        const BMGT395_ID = 1378791;
        console.log(`\nTesting BMGT395 (${BMGT395_ID}) specifically:`);
        const bmgtQuery = await weaviateClient.graphql
            .get()
            .withClassName('CanvasContent')
            .withFields(`
                title
                content
                metadata {
                    postedAt
                }
            `)
            .withWhere({
                operator: 'And',
                operands: [
                    { path: ['userId'], operator: 'Equal', valueString: USER_ID },
                    { path: ['type'], operator: 'Equal', valueString: 'announcement' },
                    { path: ['courseId'], operator: 'Equal', valueNumber: BMGT395_ID }
                ]
            })
            .withLimit(10)
            .do();

        const bmgtAnnouncements = bmgtQuery.data?.Get?.CanvasContent || [];
        console.log(`Found ${bmgtAnnouncements.length} announcements for BMGT395:`);
        bmgtAnnouncements.forEach((a, idx) => {
            console.log(`\n[${idx + 1}] ${a.title}`);
            console.log(`Posted At: ${a.metadata?.postedAt}`);
            console.log(`Content Preview: ${(a.content || '').slice(0, 150)}...`);
        });

    } catch (error) {
        console.error('❌ Error testing Weaviate announcements:', error.message);
        if (error.response?.errors) {
            console.error('GraphQL Errors:', error.response.errors);
        }
    }
}

testWeaviateAnnouncements(); 