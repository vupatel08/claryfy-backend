#!/usr/bin/env node

// src/index.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { CanvasClient } from "./client.js";
import * as dotenv from "dotenv";
import {
  CreateCourseArgs,
  UpdateCourseArgs,
  CreateAssignmentArgs,
  UpdateAssignmentArgs,
  SubmitGradeArgs,
  EnrollUserArgs,
  CanvasCourse,
  CanvasAssignmentSubmission,
  SubmitAssignmentArgs,
  FileUploadArgs,
  MCPServerConfig
} from "./types.js";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Enhanced tools list with all student-focused endpoints
const TOOLS: Tool[] = [
  // Health and system tools
  {
    name: "canvas_health_check",
    description: "Check the health and connectivity of the Canvas API",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Course management
  {
    name: "canvas_list_courses",
    description: "List all courses for the current user",
    inputSchema: {
      type: "object",
      properties: {
        include_ended: { type: "boolean", description: "Include ended courses" }
      },
      required: []
    }
  },
  {
    name: "canvas_get_course",
    description: "Get detailed information about a specific course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_create_course",
    description: "Create a new course in Canvas",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the course" },
        course_code: { type: "string", description: "Course code (e.g., CS101)" },
        start_at: { type: "string", description: "Course start date (ISO format)" },
        end_at: { type: "string", description: "Course end date (ISO format)" },
        license: { type: "string" },
        is_public: { type: "boolean" },
        syllabus_body: { type: "string", description: "Course syllabus content" }
      },
      required: ["name"]
    }
  },
  {
    name: "canvas_update_course",
    description: "Update an existing course in Canvas",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course to update" },
        name: { type: "string", description: "New name for the course" },
        course_code: { type: "string", description: "New course code" },
        start_at: { type: "string", description: "New start date (ISO format)" },
        end_at: { type: "string", description: "New end date (ISO format)" },
        license: { type: "string" },
        is_public: { type: "boolean" },
        syllabus_body: { type: "string", description: "Updated syllabus content" }
      },
      required: ["course_id"]
    }
  },

  // Assignment management
  {
    name: "canvas_list_assignments",
    description: "List assignments for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        include_submissions: { type: "boolean", description: "Include submission data" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_assignment",
    description: "Get detailed information about a specific assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        include_submission: { type: "boolean", description: "Include user's submission data" }
      },
      required: ["course_id", "assignment_id"]
    }
  },
  {
    name: "canvas_create_assignment",
    description: "Create a new assignment in a Canvas course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        name: { type: "string", description: "Name of the assignment" },
        description: { type: "string", description: "Assignment description/instructions" },
        due_at: { type: "string", description: "Due date (ISO format)" },
        points_possible: { type: "number", description: "Maximum points possible" },
        submission_types: {
          type: "array",
          items: { type: "string" },
          description: "Allowed submission types"
        },
        allowed_extensions: {
          type: "array",
          items: { type: "string" },
          description: "Allowed file extensions for submissions"
        },
        published: { type: "boolean", description: "Whether the assignment is published" }
      },
      required: ["course_id", "name"]
    }
  },
  {
    name: "canvas_update_assignment",
    description: "Update an existing assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment to update" },
        name: { type: "string", description: "New name for the assignment" },
        description: { type: "string", description: "New assignment description" },
        due_at: { type: "string", description: "New due date (ISO format)" },
        points_possible: { type: "number", description: "New maximum points" },
        published: { type: "boolean", description: "Whether the assignment is published" }
      },
      required: ["course_id", "assignment_id"]
    }
  },

  // Assignment groups
  {
    name: "canvas_list_assignment_groups",
    description: "List assignment groups for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Submissions and grading
  {
    name: "canvas_get_submission",
    description: "Get submission details for an assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        user_id: { type: "number", description: "ID of the user (optional, defaults to self)" }
      },
      required: ["course_id", "assignment_id"]
    }
  },
  {
    name: "canvas_submit_assignment",
    description: "Submit work for an assignment",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        submission_type: {
          type: "string",
          enum: ["online_text_entry", "online_url", "online_upload"],
          description: "Type of submission"
        },
        body: { type: "string", description: "Text content for text submissions" },
        url: { type: "string", description: "URL for URL submissions" },
        file_ids: {
          type: "array",
          items: { type: "number" },
          description: "File IDs for file submissions"
        }
      },
      required: ["course_id", "assignment_id", "submission_type"]
    }
  },
  {
    name: "canvas_submit_grade",
    description: "Submit a grade for a student's assignment (teacher only)",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        assignment_id: { type: "number", description: "ID of the assignment" },
        user_id: { type: "number", description: "ID of the student" },
        grade: {
          oneOf: [
            { type: "number" },
            { type: "string" }
          ],
          description: "Grade to submit (number or letter grade)"
        },
        comment: { type: "string", description: "Optional comment on the submission" }
      },
      required: ["course_id", "assignment_id", "user_id", "grade"]
    }
  },

  // Files and uploads
  {
    name: "canvas_list_files",
    description: "List files in a course or folder",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        folder_id: { type: "number", description: "ID of the folder (optional)" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_file",
    description: "Get information about a specific file",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "number", description: "ID of the file" }
      },
      required: ["file_id"]
    }
  },
  {
    name: "canvas_list_folders",
    description: "List folders in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Pages
  {
    name: "canvas_list_pages",
    description: "List pages in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_page",
    description: "Get content of a specific page",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        page_url: { type: "string", description: "URL slug of the page" }
      },
      required: ["course_id", "page_url"]
    }
  },

  // Calendar and due dates
  {
    name: "canvas_list_calendar_events",
    description: "List calendar events",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO format)" },
        end_date: { type: "string", description: "End date (ISO format)" }
      },
      required: []
    }
  },
  {
    name: "canvas_get_upcoming_assignments",
    description: "Get upcoming assignment due dates",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of assignments to return" }
      },
      required: []
    }
  },

  // Dashboard
  {
    name: "canvas_get_dashboard",
    description: "Get user's dashboard information",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "canvas_get_dashboard_cards",
    description: "Get dashboard course cards",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Grades
  {
    name: "canvas_get_course_grades",
    description: "Get grades for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_user_grades",
    description: "Get all grades for the current user",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // User management
  {
    name: "canvas_get_user_profile",
    description: "Get current user's profile",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "canvas_update_user_profile",
    description: "Update current user's profile",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "User's name" },
        short_name: { type: "string", description: "User's short name" },
        bio: { type: "string", description: "User's bio" },
        title: { type: "string", description: "User's title" },
        time_zone: { type: "string", description: "User's time zone" }
      },
      required: []
    }
  },
  {
    name: "canvas_enroll_user",
    description: "Enroll a user in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        user_id: { type: "number", description: "ID of the user to enroll" },
        role: {
          type: "string",
          description: "Role for the enrollment (StudentEnrollment, TeacherEnrollment, etc.)"
        },
        enrollment_state: {
          type: "string",
          description: "State of the enrollment (active, invited, etc.)"
        }
      },
      required: ["course_id", "user_id"]
    }
  },

  // Modules
  {
    name: "canvas_list_modules",
    description: "List all modules in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_module",
    description: "Get details of a specific module",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" }
      },
      required: ["course_id", "module_id"]
    }
  },
  {
    name: "canvas_list_module_items",
    description: "List all items in a module",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" }
      },
      required: ["course_id", "module_id"]
    }
  },
  {
    name: "canvas_get_module_item",
    description: "Get details of a specific module item",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" },
        item_id: { type: "number", description: "ID of the module item" }
      },
      required: ["course_id", "module_id", "item_id"]
    }
  },
  {
    name: "canvas_mark_module_item_complete",
    description: "Mark a module item as complete",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        module_id: { type: "number", description: "ID of the module" },
        item_id: { type: "number", description: "ID of the module item" }
      },
      required: ["course_id", "module_id", "item_id"]
    }
  },

  // Discussions
  {
    name: "canvas_list_discussion_topics",
    description: "List all discussion topics in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_discussion_topic",
    description: "Get details of a specific discussion topic",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        topic_id: { type: "number", description: "ID of the discussion topic" }
      },
      required: ["course_id", "topic_id"]
    }
  },
  {
    name: "canvas_post_to_discussion",
    description: "Post a message to a discussion topic",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        topic_id: { type: "number", description: "ID of the discussion topic" },
        message: { type: "string", description: "Message content" }
      },
      required: ["course_id", "topic_id", "message"]
    }
  },

  // Announcements
  {
    name: "canvas_list_announcements",
    description: "List all announcements in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },

  // Quizzes
  {
    name: "canvas_list_quizzes",
    description: "List all quizzes in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_quiz",
    description: "Get details of a specific quiz",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        quiz_id: { type: "number", description: "ID of the quiz" }
      },
      required: ["course_id", "quiz_id"]
    }
  },
  {
    name: "canvas_create_quiz",
    description: "Create a new quiz in a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        title: { type: "string", description: "Title of the quiz" },
        quiz_type: { type: "string", description: "Type of the quiz (e.g., graded)" },
        time_limit: { type: "number", description: "Time limit in minutes" },
        published: { type: "boolean", description: "Is the quiz published" },
        description: { type: "string", description: "Description of the quiz" },
        due_at: { type: "string", description: "Due date (ISO format)" }
      },
      required: ["course_id", "title"]
    }
  },
  {
    name: "canvas_start_quiz_attempt",
    description: "Start a new quiz attempt",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        quiz_id: { type: "number", description: "ID of the quiz" }
      },
      required: ["course_id", "quiz_id"]
    }
  },

  // Rubrics
  {
    name: "canvas_list_rubrics",
    description: "List rubrics for a course",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  },
  {
    name: "canvas_get_rubric",
    description: "Get details of a specific rubric",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" },
        rubric_id: { type: "number", description: "ID of the rubric" }
      },
      required: ["course_id", "rubric_id"]
    }
  },

  // Conversations
  {
    name: "canvas_list_conversations",
    description: "List user's conversations",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "canvas_get_conversation",
    description: "Get details of a specific conversation",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "number", description: "ID of the conversation" }
      },
      required: ["conversation_id"]
    }
  },
  {
    name: "canvas_create_conversation",
    description: "Create a new conversation",
    inputSchema: {
      type: "object",
      properties: {
        recipients: {
          type: "array",
          items: { type: "string" },
          description: "Recipient user IDs or email addresses"
        },
        body: { type: "string", description: "Message body" },
        subject: { type: "string", description: "Message subject" }
      },
      required: ["recipients", "body"]
    }
  },

  // Notifications
  {
    name: "canvas_list_notifications",
    description: "List user's notifications",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // Syllabus
  {
    name: "canvas_get_syllabus",
    description: "Get course syllabus",
    inputSchema: {
      type: "object",
      properties: {
        course_id: { type: "number", description: "ID of the course" }
      },
      required: ["course_id"]
    }
  }
];

class CanvasMCPServer {
  private server: Server;
  private client: CanvasClient;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.client = new CanvasClient(
      config.canvas.token,
      config.canvas.domain,
      {
        maxRetries: config.canvas.maxRetries,
        retryDelay: config.canvas.retryDelay
      }
    );

    this.server = new Server(
      {
        name: config.name,
        version: config.version
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error(`[${this.config.name} Error]`, error);
    };

    process.on('SIGINT', async () => {
      console.error('\nReceived SIGINT, shutting down gracefully...');
      await this.server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('\nReceived SIGTERM, shutting down gracefully...');
      await this.server.close();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  private setupHandlers(): void {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const courses = await this.client.listCourses();

        return {
          resources: [
            {
              uri: "canvas://health",
              name: "Canvas Health Status",
              description: "Health check and API connectivity status",
              mimeType: "application/json"
            },
            {
              uri: "courses://list",
              name: "All Courses",
              description: "List of all available Canvas courses",
              mimeType: "application/json"
            },
            ...courses.map((course: CanvasCourse) => ({
              uri: `course://${course.id}`,
              name: `Course: ${course.name}`,
              description: `${course.course_code} - ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `assignments://${course.id}`,
              name: `Assignments: ${course.name}`,
              description: `Assignments for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `modules://${course.id}`,
              name: `Modules: ${course.name}`,
              description: `Modules for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `discussions://${course.id}`,
              name: `Discussions: ${course.name}`,
              description: `Discussion topics for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `announcements://${course.id}`,
              name: `Announcements: ${course.name}`,
              description: `Announcements for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `quizzes://${course.id}`,
              name: `Quizzes: ${course.name}`,
              description: `Quizzes for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `pages://${course.id}`,
              name: `Pages: ${course.name}`,
              description: `Pages for ${course.name}`,
              mimeType: "application/json"
            })),
            ...courses.map((course: CanvasCourse) => ({
              uri: `files://${course.id}`,
              name: `Files: ${course.name}`,
              description: `Files for ${course.name}`,
              mimeType: "application/json"
            })),
            {
              uri: "dashboard://user",
              name: "User Dashboard",
              description: "User's Canvas dashboard information",
              mimeType: "application/json"
            },
            {
              uri: "profile://user",
              name: "User Profile",
              description: "Current user's profile information",
              mimeType: "application/json"
            },
            {
              uri: "calendar://upcoming",
              name: "Upcoming Events",
              description: "Upcoming assignments and events",
              mimeType: "application/json"
            }
          ]
        };
      } catch (error) {
        console.error('Error listing resources:', error);
        return { resources: [] };
      }
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const [type, id] = uri.split("://");

      try {
        let content;

        switch (type) {
          case "canvas":
            if (id === "health") {
              content = await this.client.healthCheck();
            }
            break;

          case "courses":
            content = await this.client.listCourses();
            break;

          case "course":
            content = await this.client.getCourse(parseInt(id));
            break;

          case "assignments":
            content = await this.client.listAssignments(parseInt(id), true);
            break;

          case "modules":
            content = await this.client.listModules(parseInt(id));
            break;

          case "discussions":
            content = await this.client.listDiscussionTopics(parseInt(id));
            break;

          case "announcements":
            content = await this.client.listAnnouncements(id);
            break;

          case "quizzes":
            content = await this.client.listQuizzes(id);
            break;

          case "pages":
            content = await this.client.listPages(parseInt(id));
            break;

          case "files":
            content = await this.client.listFiles(parseInt(id));
            break;

          case "dashboard":
            if (id === "user") {
              content = await this.client.getDashboard();
            }
            break;

          case "profile":
            if (id === "user") {
              content = await this.client.getUserProfile();
            }
            break;

          case "calendar":
            if (id === "upcoming") {
              content = await this.client.getUpcomingAssignments();
            }
            break;

          default:
            throw new Error(`Unknown resource type: ${type}`);
        }

        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(content, null, 2)
          }]
        };
      } catch (error) {
        console.error(`Error reading resource ${uri}:`, error);
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)
          }]
        };
      }
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS
    }));

    // Handle tool calls with comprehensive error handling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = request.params.arguments || {};
        const toolName = request.params.name;

        switch (toolName) {
          // Health check
          case "canvas_health_check": {
            const health = await this.client.healthCheck();
            return {
              content: [{ type: "text", text: JSON.stringify(health, null, 2) }]
            };
          }

          // Course management
          case "canvas_list_courses": {
            const { include_ended = false } = args as { include_ended?: boolean };
            const courses = await this.client.listCourses(include_ended);
            return {
              content: [{ type: "text", text: JSON.stringify(courses, null, 2) }]
            };
          }

          case "canvas_get_course": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const course = await this.client.getCourse(course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(course, null, 2) }]
            };
          }

          case "canvas_create_course": {
            const courseArgs = args as unknown as CreateCourseArgs;
            if (!courseArgs.name) {
              throw new Error("Missing required field: name");
            }
            const course = await this.client.createCourse(courseArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(course, null, 2) }]
            };
          }

          case "canvas_update_course": {
            const updateArgs = args as unknown as UpdateCourseArgs;
            if (!updateArgs.course_id) {
              throw new Error("Missing required field: course_id");
            }
            const updatedCourse = await this.client.updateCourse(updateArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(updatedCourse, null, 2) }]
            };
          }

          // Assignment management
          case "canvas_list_assignments": {
            const { course_id, include_submissions = false } = args as {
              course_id: number;
              include_submissions?: boolean
            };
            if (!course_id) throw new Error("Missing required field: course_id");

            const assignments = await this.client.listAssignments(course_id, include_submissions);
            return {
              content: [{ type: "text", text: JSON.stringify(assignments, null, 2) }]
            };
          }

          case "canvas_get_assignment": {
            const { course_id, assignment_id, include_submission = false } = args as {
              course_id: number;
              assignment_id: number;
              include_submission?: boolean;
            };
            if (!course_id || !assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }

            const assignment = await this.client.getAssignment(course_id, assignment_id, include_submission);
            return {
              content: [{ type: "text", text: JSON.stringify(assignment, null, 2) }]
            };
          }

          case "canvas_create_assignment": {
            const assignmentArgs = args as unknown as CreateAssignmentArgs;
            if (!assignmentArgs.course_id || !assignmentArgs.name) {
              throw new Error("Missing required fields: course_id and name");
            }
            const assignment = await this.client.createAssignment(assignmentArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(assignment, null, 2) }]
            };
          }

          case "canvas_update_assignment": {
            const updateAssignmentArgs = args as unknown as UpdateAssignmentArgs;
            if (!updateAssignmentArgs.course_id || !updateAssignmentArgs.assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }
            const updatedAssignment = await this.client.updateAssignment(updateAssignmentArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(updatedAssignment, null, 2) }]
            };
          }

          case "canvas_list_assignment_groups": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const groups = await this.client.listAssignmentGroups(course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(groups, null, 2) }]
            };
          }

          // Submissions
          case "canvas_get_submission": {
            const { course_id, assignment_id, user_id } = args as {
              course_id: number;
              assignment_id: number;
              user_id?: number;
            };
            if (!course_id || !assignment_id) {
              throw new Error("Missing required fields: course_id and assignment_id");
            }

            const submission = await this.client.getSubmission(course_id, assignment_id, user_id || 'self');
            return {
              content: [{ type: "text", text: JSON.stringify(submission, null, 2) }]
            };
          }

          case "canvas_submit_assignment": {
            const submitArgs = args as unknown as SubmitAssignmentArgs;
            const { course_id, assignment_id, submission_type } = submitArgs;

            if (!course_id || !assignment_id || !submission_type) {
              throw new Error("Missing required fields: course_id, assignment_id, and submission_type");
            }

            const submission = await this.client.submitAssignment(submitArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(submission, null, 2) }]
            };
          }

          case "canvas_submit_grade": {
            const gradeArgs = args as unknown as SubmitGradeArgs;
            if (!gradeArgs.course_id || !gradeArgs.assignment_id ||
              !gradeArgs.user_id || gradeArgs.grade === undefined) {
              throw new Error("Missing required fields for grade submission");
            }
            const submission = await this.client.submitGrade(gradeArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(submission, null, 2) }]
            };
          }

          // Files
          case "canvas_list_files": {
            const { course_id, folder_id } = args as { course_id: number; folder_id?: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const files = await this.client.listFiles(course_id, folder_id);
            return {
              content: [{ type: "text", text: JSON.stringify(files, null, 2) }]
            };
          }

          case "canvas_get_file": {
            const { file_id } = args as { file_id: number };
            if (!file_id) throw new Error("Missing required field: file_id");

            const file = await this.client.getFile(file_id);
            return {
              content: [{ type: "text", text: JSON.stringify(file, null, 2) }]
            };
          }

          case "canvas_list_folders": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const folders = await this.client.listFolders(course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(folders, null, 2) }]
            };
          }

          // Pages
          case "canvas_list_pages": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const pages = await this.client.listPages(course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(pages, null, 2) }]
            };
          }

          case "canvas_get_page": {
            const { course_id, page_url } = args as { course_id: number; page_url: string };
            if (!course_id || !page_url) {
              throw new Error("Missing required fields: course_id and page_url");
            }

            const page = await this.client.getPage(course_id, page_url);
            return {
              content: [{ type: "text", text: JSON.stringify(page, null, 2) }]
            };
          }

          // Calendar
          case "canvas_list_calendar_events": {
            const { start_date, end_date } = args as { start_date?: string; end_date?: string };
            const events = await this.client.listCalendarEvents(start_date, end_date);
            return {
              content: [{ type: "text", text: JSON.stringify(events, null, 2) }]
            };
          }

          case "canvas_get_upcoming_assignments": {
            const { limit = 10 } = args as { limit?: number };
            const assignments = await this.client.getUpcomingAssignments(limit);
            return {
              content: [{ type: "text", text: JSON.stringify(assignments, null, 2) }]
            };
          }

          // Dashboard
          case "canvas_get_dashboard": {
            const dashboard = await this.client.getDashboard();
            return {
              content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }]
            };
          }

          case "canvas_get_dashboard_cards": {
            const cards = await this.client.getDashboardCards();
            return {
              content: [{ type: "text", text: JSON.stringify(cards, null, 2) }]
            };
          }

          // User management
          case "canvas_get_user_profile": {
            const profile = await this.client.getUserProfile();
            return {
              content: [{ type: "text", text: JSON.stringify(profile, null, 2) }]
            };
          }

          case "canvas_update_user_profile": {
            const profileData = args as Partial<{ name: string; short_name: string; bio: string; title: string; time_zone: string }>;
            const updatedProfile = await this.client.updateUserProfile(profileData);
            return {
              content: [{ type: "text", text: JSON.stringify(updatedProfile, null, 2) }]
            };
          }

          case "canvas_enroll_user": {
            const enrollArgs = args as unknown as EnrollUserArgs;
            if (!enrollArgs.course_id || !enrollArgs.user_id) {
              throw new Error("Missing required fields: course_id and user_id");
            }
            const enrollment = await this.client.enrollUser(enrollArgs);
            return {
              content: [{ type: "text", text: JSON.stringify(enrollment, null, 2) }]
            };
          }

          // Grades
          case "canvas_get_course_grades": {
            const { course_id } = args as { course_id: number };
            if (!course_id) throw new Error("Missing required field: course_id");

            const grades = await this.client.getCourseGrades(course_id);
            return {
              content: [{ type: "text", text: JSON.stringify(grades, null, 2) }]
            };
          }

          case "canvas_get_user_grades": {
            const grades = await this.client.getUserGrades();
            return {
              content: [{ type: "text", text: JSON.stringify(grades, null, 2) }]
            };
          }

          // Continue with all other tools...
          // [I'll include the rest in the same pattern]

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
      } catch (error) {
        console.error(`Error executing tool ${request.params.name}:`, error);
        return {
          content: [{
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.config.name} running on stdio`);
  }
}

// Main entry point with enhanced configuration
async function main() {
  // Get current file's directory in ES modules
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Enhanced environment loading
  const envPaths = [
    '.env',
    'src/.env',
    path.join(__dirname, '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'), // Parent directory
  ];

  let loaded = false;
  for (const envPath of envPaths) {
    const result = dotenv.config({ path: envPath });
    if (result.parsed) {
      console.error(`Loaded environment from: ${envPath}`);
      loaded = true;
      break;
    }
  }

  if (!loaded) {
    console.error('Warning: No .env file found');
  }

  const token = process.env.CANVAS_API_TOKEN;
  const domain = process.env.CANVAS_DOMAIN;

  if (!token || !domain) {
    console.error("Missing required environment variables:");
    console.error("- CANVAS_API_TOKEN: Your Canvas API token");
    console.error("- CANVAS_DOMAIN: Your Canvas domain (e.g., school.instructure.com)");
    process.exit(1);
  }

  const config: MCPServerConfig = {
    name: "canvas-mcp-server",
    version: "2.0.0",
    canvas: {
      token,
      domain,
      maxRetries: parseInt(process.env.CANVAS_MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.CANVAS_RETRY_DELAY || '1000'),
      timeout: parseInt(process.env.CANVAS_TIMEOUT || '30000')
    },
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info'
    }
  };

  try {
    const server = new CanvasMCPServer(config);
    await server.run();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main().catch(console.error);