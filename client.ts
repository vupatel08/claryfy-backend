// src/client.ts

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  CanvasCourse,
  CanvasAssignment,
  CanvasSubmission,
  CanvasUser,
  CanvasEnrollment,
  CreateCourseArgs,
  UpdateCourseArgs,
  CreateAssignmentArgs,
  UpdateAssignmentArgs,
  SubmitGradeArgs,
  EnrollUserArgs,
  CanvasAPIError,
  CanvasDiscussionTopic,
  CanvasModule,
  CanvasModuleItem,
  CanvasQuiz,
  CanvasAnnouncement,
  CanvasUserProfile,
  CanvasScope,
  CanvasAssignmentSubmission,
  CanvasPage,
  CanvasCalendarEvent,
  CanvasRubric,
  CanvasAssignmentGroup,
  CanvasConversation,
  CanvasNotification,
  CanvasFile,
  CanvasSyllabus,
  CanvasDashboard,
  SubmitAssignmentArgs,
  FileUploadArgs
} from './types.js';

export class CanvasClient {
  private client: AxiosInstance;
  private baseURL: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000;
  private requestQueue: Array<() => Promise<any>> = [];
  private activeRequests: number = 0;
  private maxConcurrentRequests: number = 12;

  constructor(token: string, domain: string, options?: { maxRetries?: number; retryDelay?: number; maxConcurrentRequests?: number }) {
    this.baseURL = `https://${domain}/api/v1`;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelay = options?.retryDelay ?? 1000;
    this.maxConcurrentRequests = options?.maxConcurrentRequests ?? 12;

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.error(`[Canvas API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[Canvas API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for pagination and retry logic
    this.client.interceptors.response.use(
      async (response) => {
        const { headers, data, config } = response;
        const linkHeader = headers.link;

        // Handle pagination automatically, but only for initial requests (not follow-up pagination requests)
        if (Array.isArray(data) && linkHeader && !(config as any)._isPaginationRequest) {
          let allData = [...data];
          let nextUrl = this.getNextPageUrl(linkHeader);

          while (nextUrl) {
            // Mark this as a pagination request to avoid recursive pagination
            const nextResponse = await this.client.get(nextUrl, { _isPaginationRequest: true } as any);
            allData = [...allData, ...nextResponse.data];
            nextUrl = this.getNextPageUrl(nextResponse.headers.link);
          }

          response.data = allData;
        }

        return response;
      },
      async (error: AxiosError) => {
        const config = error.config as any;

        // Retry logic for specific errors
        if (this.shouldRetry(error) && config && config.__retryCount < this.maxRetries) {
          config.__retryCount = config.__retryCount || 0;
          config.__retryCount++;

          const delay = this.retryDelay * Math.pow(2, config.__retryCount - 1); // Exponential backoff
          console.error(`[Canvas API] Retrying request (${config.__retryCount}/${this.maxRetries}) after ${delay}ms`);

          await this.sleep(delay);
          return this.client.request(config);
        }

        // Transform error
        if (error.response) {
          const { status, data } = error.response;
          throw new CanvasAPIError(
            `Canvas API Error (${status}): ${((data as any)?.message) || JSON.stringify(data)}`,
            status,
            data
          );
        }

        throw error;
      }
    );
  }

  private shouldRetry(error: AxiosError): boolean {
    if (!error.response) return true; // Network errors

    const status = error.response.status;
    return status === 429 || status >= 500; // Rate limit or server errors
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Enhanced request processing with concurrency control
  private async processRequestQueue(): Promise<void> {
    while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
      const request = this.requestQueue.shift();
      if (request) {
        this.activeRequests++;
        request().finally(() => {
          this.activeRequests--;
          this.processRequestQueue(); // Process next in queue
        });
      }
    }
  }

  private queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processRequestQueue();
    });
  }

  private getNextPageUrl(linkHeader: string): string | null {
    const links = linkHeader.split(',');
    const nextLink = links.find(link => link.includes('rel="next"'));
    if (!nextLink) return null;

    const match = nextLink.match(/<(.+?)>/);
    return match ? match[1] : null;
  }

  // ---------------------
  // HEALTH CHECK
  // ---------------------
  async healthCheck(): Promise<{ status: 'ok' | 'error'; timestamp: string; user?: any }> {
    try {
      const user = await this.getUserProfile();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        user: { id: user.id, name: user.name }
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString()
      };
    }
  }

  // ---------------------
  // COURSES (Enhanced)
  // ---------------------
  async listCourses(includeEnded: boolean = false): Promise<CanvasCourse[]> {
    const params: any = {
      include: ['total_students', 'teachers', 'term', 'course_progress']
    };

    if (!includeEnded) {
      params.state = ['available', 'completed'];
    }

    const response = await this.client.get('/courses', { params });
    return response.data;
  }

  async getCourse(courseId: number): Promise<CanvasCourse> {
    const response = await this.client.get(`/courses/${courseId}`, {
      params: {
        include: ['total_students', 'teachers', 'term', 'course_progress', 'sections', 'syllabus_body']
      }
    });
    return response.data;
  }

  async createCourse(args: CreateCourseArgs): Promise<CanvasCourse> {
    const response = await this.client.post('/courses', {
      course: args
    });
    return response.data;
  }

  async updateCourse(args: UpdateCourseArgs): Promise<CanvasCourse> {
    const { course_id, ...courseData } = args;
    const response = await this.client.put(`/courses/${course_id}`, {
      course: courseData
    });
    return response.data;
  }

  async deleteCourse(courseId: number): Promise<void> {
    await this.client.delete(`/courses/${courseId}`);
  }

  // ---------------------
  // ASSIGNMENTS (Enhanced)
  // ---------------------
  async listAssignments(courseId: number, includeSubmissions: boolean = false): Promise<CanvasAssignment[]> {
    const params: any = {
      include: ['assignment_group', 'rubric', 'due_at', 'description']
    };

    if (includeSubmissions) {
      params.include.push('submission');
    }

    const response = await this.client.get(`/courses/${courseId}/assignments`, { params });
    return response.data;
  }

  async getAssignment(courseId: number, assignmentId: number, includeSubmission: boolean = false): Promise<CanvasAssignment> {
    const params: any = {
      include: ['assignment_group', 'rubric']
    };

    if (includeSubmission) {
      params.include.push('submission');
    }

    const response = await this.client.get(`/courses/${courseId}/assignments/${assignmentId}`, { params });
    return response.data;
  }

  async createAssignment(args: CreateAssignmentArgs): Promise<CanvasAssignment> {
    const { course_id, ...assignmentData } = args;
    const response = await this.client.post(`/courses/${course_id}/assignments`, {
      assignment: assignmentData
    });
    return response.data;
  }

  async updateAssignment(args: UpdateAssignmentArgs): Promise<CanvasAssignment> {
    const { course_id, assignment_id, ...assignmentData } = args;
    const response = await this.client.put(
      `/courses/${course_id}/assignments/${assignment_id}`,
      { assignment: assignmentData }
    );
    return response.data;
  }

  async deleteAssignment(courseId: number, assignmentId: number): Promise<void> {
    await this.client.delete(`/courses/${courseId}/assignments/${assignmentId}`);
  }

  // ---------------------
  // ASSIGNMENT GROUPS
  // ---------------------
  async listAssignmentGroups(courseId: number): Promise<CanvasAssignmentGroup[]> {
    const response = await this.client.get(`/courses/${courseId}/assignment_groups`, {
      params: {
        include: ['assignments']
      }
    });
    return response.data;
  }

  async getAssignmentGroup(courseId: number, groupId: number): Promise<CanvasAssignmentGroup> {
    const response = await this.client.get(`/courses/${courseId}/assignment_groups/${groupId}`, {
      params: {
        include: ['assignments']
      }
    });
    return response.data;
  }

  // ---------------------
  // SUBMISSIONS (Enhanced for Students)
  // ---------------------
  async getSubmissions(courseId: number, assignmentId: number): Promise<CanvasSubmission[]> {
    const response = await this.client.get(
      `/courses/${courseId}/assignments/${assignmentId}/submissions`,
      {
        params: {
          include: ['submission_comments', 'rubric_assessment', 'assignment']
        }
      }
    );
    return response.data;
  }

  async getSubmission(courseId: number, assignmentId: number, userId: number | 'self' = 'self'): Promise<CanvasSubmission> {
    const response = await this.client.get(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
      {
        params: {
          include: ['submission_comments', 'rubric_assessment', 'assignment']
        }
      }
    );
    return response.data;
  }

  async submitGrade(args: SubmitGradeArgs): Promise<CanvasSubmission> {
    const { course_id, assignment_id, user_id, grade, comment } = args;
    const response = await this.client.put(
      `/courses/${course_id}/assignments/${assignment_id}/submissions/${user_id}`, {
      submission: {
        posted_grade: grade,
        comment: comment ? { text_comment: comment } : undefined
      }
    });
    return response.data;
  }

  // Student submission with file support
  async submitAssignment(args: SubmitAssignmentArgs): Promise<CanvasAssignmentSubmission> {
    const { course_id, assignment_id, submission_type, body, url, file_ids } = args;

    const submissionData: any = {
      submission_type
    };

    if (body) submissionData.body = body;
    if (url) submissionData.url = url;
    if (file_ids && file_ids.length > 0) submissionData.file_ids = file_ids;

    const response = await this.client.post(
      `/courses/${course_id}/assignments/${assignment_id}/submissions`,
      { submission: submissionData }
    );
    return response.data;
  }

  // ---------------------
  // FILES (Enhanced)
  // ---------------------
  async listFiles(courseId: number, folderId?: number): Promise<CanvasFile[]> {
    const endpoint = folderId
      ? `/folders/${folderId}/files`
      : `/courses/${courseId}/files`;

    const response = await this.client.get(endpoint);
    return response.data;
  }

  async getFile(fileId: number): Promise<CanvasFile> {
    const response = await this.client.get(`/files/${fileId}`);
    return response.data;
  }

  async uploadFile(args: FileUploadArgs): Promise<CanvasFile> {
    const { course_id, folder_id, name, size } = args;

    // Step 1: Get upload URL
    const uploadEndpoint = folder_id
      ? `/folders/${folder_id}/files`
      : `/courses/${course_id}/files`;

    const uploadResponse = await this.client.post(uploadEndpoint, {
      name,
      size,
      content_type: args.content_type || 'application/octet-stream'
    });

    // Note: Actual file upload would require multipart form data handling
    // This is a simplified version - in practice, you'd need to handle the 
    // two-step upload process Canvas uses
    return uploadResponse.data;
  }

  async listFolders(courseId: number): Promise<any[]> {
    const response = await this.client.get(`/courses/${courseId}/folders`);
    return response.data;
  }

  // ---------------------
  // PAGES
  // ---------------------
  async listPages(courseId: number): Promise<CanvasPage[]> {
    const response = await this.client.get(`/courses/${courseId}/pages`);
    return response.data;
  }

  async getPage(courseId: number, pageUrl: string): Promise<CanvasPage> {
    const response = await this.client.get(`/courses/${courseId}/pages/${pageUrl}`);
    return response.data;
  }

  // ---------------------
  // CALENDAR EVENTS
  // ---------------------
  async listCalendarEvents(startDate?: string, endDate?: string): Promise<CanvasCalendarEvent[]> {
    const params: any = {
      type: 'event',
      all_events: true
    };

    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    const response = await this.client.get('/calendar_events', { params });
    return response.data;
  }

  async getUpcomingAssignments(limit: number = 10): Promise<CanvasAssignment[]> {
    const response = await this.client.get('/users/self/upcoming_events', {
      params: { limit }
    });
    return response.data.filter((event: any) => event.assignment);
  }

  // ---------------------
  // RUBRICS
  // ---------------------
  async listRubrics(courseId: number): Promise<CanvasRubric[]> {
    const response = await this.client.get(`/courses/${courseId}/rubrics`);
    return response.data;
  }

  async getRubric(courseId: number, rubricId: number): Promise<CanvasRubric> {
    const response = await this.client.get(`/courses/${courseId}/rubrics/${rubricId}`);
    return response.data;
  }

  // ---------------------
  // DASHBOARD
  // ---------------------
  async getDashboard(): Promise<CanvasDashboard> {
    const response = await this.client.get('/users/self/dashboard');
    return response.data;
  }

  async getDashboardCards(): Promise<any[]> {
    const response = await this.client.get('/dashboard/dashboard_cards');
    return response.data;
  }

  // ---------------------
  // SYLLABUS
  // ---------------------
  async getSyllabus(courseId: number): Promise<CanvasSyllabus> {
    const response = await this.client.get(`/courses/${courseId}`, {
      params: {
        include: ['syllabus_body']
      }
    });
    return {
      course_id: courseId,
      syllabus_body: response.data.syllabus_body
    };
  }

  // ---------------------
  // CONVERSATIONS/MESSAGING
  // ---------------------
  async listConversations(): Promise<CanvasConversation[]> {
    const response = await this.client.get('/conversations');
    return response.data;
  }

  async getConversation(conversationId: number): Promise<CanvasConversation> {
    const response = await this.client.get(`/conversations/${conversationId}`);
    return response.data;
  }

  async createConversation(recipients: string[], body: string, subject?: string): Promise<CanvasConversation> {
    const response = await this.client.post('/conversations', {
      recipients,
      body,
      subject
    });
    return response.data;
  }

  // ---------------------
  // NOTIFICATIONS
  // ---------------------
  async listNotifications(): Promise<CanvasNotification[]> {
    const response = await this.client.get('/users/self/activity_stream');
    return response.data;
  }

  // ---------------------
  // USERS AND ENROLLMENTS (Enhanced)
  // ---------------------
  async listUsers(courseId: number): Promise<CanvasUser[]> {
    const response = await this.client.get(`/courses/${courseId}/users`, {
      params: {
        include: ['email', 'enrollments', 'avatar_url']
      }
    });
    return response.data;
  }

  async getEnrollments(courseId: number): Promise<CanvasEnrollment[]> {
    const response = await this.client.get(`/courses/${courseId}/enrollments`);
    return response.data;
  }

  async enrollUser(args: EnrollUserArgs): Promise<CanvasEnrollment> {
    const { course_id, user_id, role = 'StudentEnrollment', enrollment_state = 'active' } = args;
    const response = await this.client.post(`/courses/${course_id}/enrollments`, {
      enrollment: {
        user_id,
        type: role,
        enrollment_state
      }
    });
    return response.data;
  }

  async unenrollUser(courseId: number, enrollmentId: number): Promise<void> {
    await this.client.delete(`/courses/${courseId}/enrollments/${enrollmentId}`);
  }

  // ---------------------
  // GRADES (Enhanced)
  // ---------------------
  async getCourseGrades(courseId: number): Promise<CanvasEnrollment[]> {
    const response = await this.client.get(`/courses/${courseId}/enrollments`, {
      params: {
        include: ['grades', 'observed_users']
      }
    });
    return response.data;
  }

  async getUserGrades(): Promise<any> {
    const response = await this.client.get('/users/self/grades');
    return response.data;
  }

  // ---------------------
  // USER PROFILE (Enhanced)
  // ---------------------
  async getUserProfile(): Promise<CanvasUserProfile> {
    const response = await this.client.get('/users/self/profile');
    return response.data;
  }

  async updateUserProfile(profileData: Partial<CanvasUserProfile>): Promise<CanvasUserProfile> {
    const response = await this.client.put('/users/self', {
      user: profileData
    });
    return response.data;
  }

  // ---------------------
  // STUDENT COURSES (Enhanced)
  // ---------------------
  async listStudentCourses(): Promise<CanvasCourse[]> {
    const response = await this.client.get('/courses', {
      params: {
        include: ['enrollments', 'total_students', 'term', 'course_progress'],
        enrollment_state: 'active'
      }
    });
    return response.data;
  }

  // ---------------------
  // MODULES (Enhanced)
  // ---------------------
  async listModules(courseId: number): Promise<CanvasModule[]> {
    const response = await this.client.get(`/courses/${courseId}/modules`, {
      params: {
        include: ['items']
      }
    });
    return response.data;
  }

  async getModule(courseId: number, moduleId: number): Promise<CanvasModule> {
    const response = await this.client.get(`/courses/${courseId}/modules/${moduleId}`, {
      params: {
        include: ['items']
      }
    });
    return response.data;
  }

  async listModuleItems(courseId: number, moduleId: number): Promise<CanvasModuleItem[]> {
    const response = await this.client.get(`/courses/${courseId}/modules/${moduleId}/items`, {
      params: {
        include: ['content_details']
      }
    });
    return response.data;
  }

  async getModuleItem(courseId: number, moduleId: number, itemId: number): Promise<CanvasModuleItem> {
    const response = await this.client.get(`/courses/${courseId}/modules/${moduleId}/items/${itemId}`, {
      params: {
        include: ['content_details']
      }
    });
    return response.data;
  }

  async markModuleItemComplete(courseId: number, moduleId: number, itemId: number): Promise<void> {
    await this.client.put(`/courses/${courseId}/modules/${moduleId}/items/${itemId}/done`);
  }

  // ---------------------
  // DISCUSSION TOPICS (Enhanced)
  // ---------------------
  async listDiscussionTopics(courseId: number): Promise<CanvasDiscussionTopic[]> {
    const response = await this.client.get(`/courses/${courseId}/discussion_topics`, {
      params: {
        include: ['assignment']
      }
    });
    return response.data;
  }

  async getDiscussionTopic(courseId: number, topicId: number): Promise<CanvasDiscussionTopic> {
    const response = await this.client.get(`/courses/${courseId}/discussion_topics/${topicId}`, {
      params: {
        include: ['assignment']
      }
    });
    return response.data;
  }

  async postToDiscussion(courseId: number, topicId: number, message: string): Promise<any> {
    const response = await this.client.post(`/courses/${courseId}/discussion_topics/${topicId}/entries`, {
      message
    });
    return response.data;
  }

  // ---------------------
  // ANNOUNCEMENTS (Enhanced)
  // ---------------------
  async listAnnouncements(courseId: string): Promise<CanvasAnnouncement[]> {
    // Use the dedicated announcements API endpoint as per Canvas API documentation
    const response = await this.client.get('/announcements', {
      params: {
        context_codes: [`course_${courseId}`],
        active_only: true,
        include: ['sections', 'sections_user_count']
      }
    });
    return response.data;
  }

  // ---------------------
  // QUIZZES (Enhanced)
  // ---------------------
  async listQuizzes(courseId: string): Promise<CanvasQuiz[]> {
    const response = await this.client.get(`/courses/${courseId}/quizzes`);
    return response.data;
  }

  async getQuiz(courseId: string, quizId: number): Promise<CanvasQuiz> {
    const response = await this.client.get(`/courses/${courseId}/quizzes/${quizId}`);
    return response.data;
  }

  async createQuiz(courseId: number, quizData: Partial<CanvasQuiz>): Promise<CanvasQuiz> {
    const response = await this.client.post(`/courses/${courseId}/quizzes`, {
      quiz: quizData
    });
    return response.data;
  }

  async updateQuiz(courseId: number, quizId: number, quizData: Partial<CanvasQuiz>): Promise<CanvasQuiz> {
    const response = await this.client.put(`/courses/${courseId}/quizzes/${quizId}`, {
      quiz: quizData
    });
    return response.data;
  }

  async deleteQuiz(courseId: number, quizId: number): Promise<void> {
    await this.client.delete(`/courses/${courseId}/quizzes/${quizId}`);
  }

  async startQuizAttempt(courseId: number, quizId: number): Promise<any> {
    const response = await this.client.post(`/courses/${courseId}/quizzes/${quizId}/submissions`);
    return response.data;
  }

  async submitQuizAttempt(courseId: number, quizId: number, submissionId: number, answers: any): Promise<any> {
    const response = await this.client.post(
      `/courses/${courseId}/quizzes/${quizId}/submissions/${submissionId}/complete`,
      { quiz_submissions: [{ attempt: 1, questions: answers }] }
    );
    return response.data;
  }

  // ---------------------
  // SCOPES (Enhanced)
  // ---------------------
  async listTokenScopes(accountId: number, groupBy?: string): Promise<CanvasScope[]> {
    const params: Record<string, string> = {};
    if (groupBy) {
      params.group_by = groupBy;
    }

    const response = await this.client.get(`/accounts/${accountId}/scopes`, { params });
    return response.data;
  }
}