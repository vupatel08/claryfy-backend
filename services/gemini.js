import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

// =============================================
// GEMINI CONFIGURATION
// =============================================

const googleApiKey = process.env.GOOGLE_API_KEY;
let genAI = null;
let geminiModel = null;

// Initialize Gemini client if configuration is available
if (googleApiKey) {
    try {
        genAI = new GoogleGenerativeAI(googleApiKey);

        // Use Gemini 1.5 Flash for fast, cost-effective query processing
        geminiModel = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.1, // Low temperature for consistent query processing
                maxOutputTokens: 200, // Keep responses short and focused
            }
        });

        console.log('✅ Gemini query service initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Gemini client:', error);
    }
} else {
    console.log('⚠️ Google API key missing. Gemini query processing will be disabled.');
    console.log('   Set GOOGLE_API_KEY environment variable to enable enhanced query processing.');
}

// =============================================
// GEMINI QUERY PROCESSING SERVICE
// =============================================

export class GeminiQueryService {

    /**
     * Check if Gemini is available
     * @returns {boolean} Whether Gemini is configured
     */
    static isAvailable() {
        return geminiModel !== null;
    }

    /**
     * Process user query to extract Canvas-specific search parameters
     * @param {string} userQuery - The natural language query from user
     * @param {Array} userCourses - Array of user's courses
     * @returns {Object} Processed query with search parameters
     */
    static async processQuery(userQuery, userCourses = []) {
        if (!this.isAvailable()) {
            console.log('⚠️ Gemini not available, using fallback query processing');
            return this.fallbackQueryProcessing(userQuery, userCourses);
        }

        try {
            console.log('🔍 Processing query with Gemini:', userQuery);

            // Build context about user's courses
            const courseContext = userCourses.length > 0
                ? `User's courses: ${userCourses.map(c => `${c.name} (${c.course_code})`).join(', ')}`
                : 'No course information available';

            const prompt = `You are a Canvas LMS query processor. Analyze the user's natural language query and extract specific search parameters.

${courseContext}

User Query: "${userQuery}"

Extract and return ONLY a JSON object with these fields:
{
  "searchType": "assignments|announcements|files|courses|general",
  "courseFilter": "course_code or null",
  "timeFilter": "this_week|next_week|this_month|past_due|null",
  "priority": "due_soon|overdue|high_priority|null",
  "keywords": ["keyword1", "keyword2"],
  "specificItems": ["assignment_name", "file_name"],
  "intent": "find_assignments|check_deadlines|get_course_info|general_question"
}

Examples:
- "What assignments are due this week in CMSC422?" → {"searchType": "assignments", "courseFilter": "CMSC422", "timeFilter": "this_week", "priority": "due_soon", "keywords": ["assignments", "due"], "specificItems": [], "intent": "find_assignments"}
- "Tell me about PS5 in machine learning" → {"searchType": "assignments", "courseFilter": "CMSC422", "timeFilter": null, "priority": null, "keywords": ["PS5", "problem set"], "specificItems": ["PS5"], "intent": "find_assignments"}
- "What courses am I taking?" → {"searchType": "courses", "courseFilter": null, "timeFilter": null, "priority": null, "keywords": ["courses"], "specificItems": [], "intent": "get_course_info"}

Return ONLY the JSON object, no additional text.`;

            const result = await geminiModel.generateContent(prompt);
            const response = result.response;
            const text = response.text().trim();

            // Parse the JSON response
            let queryParams;
            try {
                // Clean up the response to extract JSON
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    queryParams = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No JSON found in response');
                }
            } catch (parseError) {
                console.error('Error parsing Gemini response:', parseError);
                console.error('Raw response:', text);

                // Fallback to basic query processing
                queryParams = this.fallbackQueryProcessing(userQuery, userCourses);
            }

            console.log('📋 Processed query parameters:', queryParams);
            return queryParams;

        } catch (error) {
            console.error('Error processing query with Gemini:', error);

            // Fallback to basic query processing
            return this.fallbackQueryProcessing(userQuery, userCourses);
        }
    }

    /**
     * Enhanced search query builder based on processed parameters
     * @param {Object} queryParams - Processed query parameters from Gemini
     * @param {string} originalQuery - Original user query as fallback
     * @returns {Object} Enhanced search configuration
     */
    static buildSearchQuery(queryParams, originalQuery) {
        const searchConfig = {
            query: originalQuery, // Default to original query
            filters: {},
            boost: {},
            limit: 10
        };

        // Build specific search query based on intent
        if (queryParams.intent === 'find_assignments' && queryParams.specificItems.length > 0) {
            searchConfig.query = queryParams.specificItems.join(' ') + ' ' + queryParams.keywords.join(' ');
            searchConfig.filters.type = 'assignment';
        } else if (queryParams.searchType === 'assignments') {
            searchConfig.query = queryParams.keywords.join(' ') + ' assignment';
            searchConfig.filters.type = 'assignment';
        } else if (queryParams.searchType === 'announcements') {
            searchConfig.query = queryParams.keywords.join(' ') + ' announcement';
            searchConfig.filters.type = 'announcement';
        } else if (queryParams.searchType === 'files') {
            searchConfig.query = queryParams.keywords.join(' ') + ' file';
            searchConfig.filters.type = 'file';
        }

        // Add course filter if specified
        if (queryParams.courseFilter) {
            searchConfig.filters.courseCode = queryParams.courseFilter;
        }

        // Add time-based boosting
        if (queryParams.timeFilter === 'this_week' || queryParams.priority === 'due_soon') {
            searchConfig.boost.recent = true;
            searchConfig.boost.dueDate = true;
        }

        // Adjust limit based on query type
        if (queryParams.intent === 'get_course_info') {
            searchConfig.limit = 20; // Show more courses
        } else if (queryParams.specificItems.length > 0) {
            searchConfig.limit = 5; // Focused search
        }

        return searchConfig;
    }

    /**
     * Fallback query processing when Gemini fails or is unavailable
     * @param {string} userQuery - Original user query
     * @param {Array} userCourses - User's courses
     * @returns {Object} Basic query parameters
     */
    static fallbackQueryProcessing(userQuery, userCourses) {
        const lowerQuery = userQuery.toLowerCase();

        // Basic keyword detection
        const isAssignment = /assignment|homework|hw|ps\d+|problem set|project|quiz|exam|test/i.test(userQuery);
        const isAnnouncement = /announcement|news|update|notice/i.test(userQuery);
        const isFile = /file|document|pdf|syllabus|material/i.test(userQuery);
        const isCourse = /course|class|taking|enrolled/i.test(userQuery);

        // Time filter detection
        let timeFilter = null;
        if (/this week|week/i.test(userQuery)) timeFilter = 'this_week';
        else if (/next week/i.test(userQuery)) timeFilter = 'next_week';
        else if (/due|deadline/i.test(userQuery)) timeFilter = 'this_week';

        // Course detection
        let courseFilter = null;
        for (const course of userCourses) {
            if (userQuery.includes(course.course_code) || userQuery.includes(course.name)) {
                courseFilter = course.course_code;
                break;
            }
        }

        return {
            searchType: isAssignment ? 'assignments' : isAnnouncement ? 'announcements' : isFile ? 'files' : isCourse ? 'courses' : 'general',
            courseFilter,
            timeFilter,
            priority: /due|deadline|urgent/i.test(userQuery) ? 'due_soon' : null,
            keywords: userQuery.split(' ').filter(word => word.length > 2),
            specificItems: [],
            intent: isAssignment ? 'find_assignments' : isCourse ? 'get_course_info' : 'general_question'
        };
    }

    /**
     * Generate search summary for logging/debugging
     * @param {Object} queryParams - Processed query parameters
     * @returns {string} Human-readable search summary
     */
    static generateSearchSummary(queryParams) {
        const parts = [];

        if (queryParams.searchType !== 'general') {
            parts.push(`Looking for ${queryParams.searchType}`);
        }

        if (queryParams.courseFilter) {
            parts.push(`in ${queryParams.courseFilter}`);
        }

        if (queryParams.timeFilter) {
            parts.push(`for ${queryParams.timeFilter.replace('_', ' ')}`);
        }

        if (queryParams.specificItems.length > 0) {
            parts.push(`specifically: ${queryParams.specificItems.join(', ')}`);
        }

        return parts.length > 0 ? parts.join(' ') : 'General search';
    }
}

export default GeminiQueryService; 