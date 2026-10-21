import { z } from "zod";
import {
  projectInput,
  projectSchema,
  taskInput,
  taskSchema,
} from "../../../packages/domain/types.js";
import { progressInput } from "../../../packages/domain/progress.js";
import { projectFileInput } from "../../../packages/domain/project-file.js";
import { activityQueryInput } from "../../../packages/domain/activity-query.js";
import { taskBulkUpdateInput } from "../../../packages/domain/task-bulk-update.js";
import {
  taskSchedulePatchInput,
  taskScheduleBatchInput,
} from "../../../packages/domain/task-schedule-write.js";
import { taskDependencyReplaceInput } from "../../../packages/domain/task-dependencies.js";

export interface ApiRoute {
  method: string;
  path: string;
}

/** Generated from the same validators as the handlers, so field constraints stay current. */
export function aiAccessDocumentation(routes: ApiRoute[]) {
  const schema = (input: z.ZodType) => z.toJSONSchema(input, { io: "input" });
  const contracts: Record<string, Record<string, unknown>> = {
    "GET /api/ai-access/context": {
      description:
        "Initialize: current member identity, all accessible projects with task counts, overall task overview, catalogs and workspace settings.",
      response:
        "{actor,access,revision,settings,catalogs,projectCount,projects,taskOverview,links}. Projects are complete, not paginated. Status counts include active leaf tasks only.",
    },
    "GET /api/ai-access/docs": {
      description:
        "This machine-readable API reference. All paths are relative to the system origin.",
    },
    "GET /api/workspace": {
      description:
        "Complete current-workspace snapshot, including full projects, tasks, members, catalogs, settings and recent activities.",
      response:
        "{schemaVersion,revision,projects:Project[],tasks:Task[],activities:Activity[],members,catalogs,settings,...}",
    },
    "GET /api/projects": {
      description:
        "All accessible projects; combined optional filters. No pagination.",
      query: {
        search: "string",
        stage: "stage ID",
        owner: "owner name",
        discipline: "discipline ID",
      },
      response: "Project[]",
    },
    "GET /api/projects/:id": {
      description: "Read one project.",
      response: "Project",
    },
    "POST /api/projects": {
      description:
        "Create a project. Use catalog IDs returned by context/workspace.",
      body: schema(projectInput),
      response: "Project",
    },
    "PUT /api/projects/:id": {
      description:
        "Replace project fields with expected version. Read current fields before updating.",
      body: schema(
        projectInput.extend({ version: z.number().int().positive() }),
      ),
      response: "Project",
    },
    "GET /api/tasks": {
      description:
        "Tasks across all accessible projects; combined optional filters. No pagination. Use returned task IDs and versions for subsequent calls. There is no GET /api/tasks/:id route.",
      query: {
        projectId: "project ID",
        status: "todo|in_progress|done|blocked",
        search: "title substring",
        week: "YYYY-MM-DD workWeek",
        day: "YYYY-MM-DD in workDates",
      },
      response: "Task[] (may include voided records; inspect voided)",
    },
    "POST /api/tasks": {
      description: "Create one task in an accessible project.",
      body: schema(taskInput),
      response: "Task",
    },
    "PUT /api/tasks/:id": {
      description:
        "Replace task fields with expected version. Preserve fields that should remain unchanged; do not send read-only id/updatedAt/voided fields.",
      body: schema(taskInput.extend({ version: z.number().int().positive() })),
      response: "Task",
    },
    "POST /api/tasks/batch": {
      description: "Create 1–100 tasks atomically.",
      body: schema(z.object({ tasks: z.array(taskInput).min(1).max(100) })),
      response: "Task[]",
    },
    "POST /api/tasks/bulk-update": {
      description:
        "Atomically update one field of versioned active leaf tasks.",
      body: schema(taskBulkUpdateInput),
      response: "Task[]",
    },
    "PATCH /api/tasks/:id/schedule": {
      description: "Versioned schedule patch.",
      body: schema(taskSchedulePatchInput),
      response: "Task",
    },
    "POST /api/tasks/schedule-batch": {
      description: "Atomic schedule batch.",
      body: schema(taskScheduleBatchInput),
    },
    "PUT /api/tasks/:id/dependencies": {
      description: "Replace same-project leaf predecessor edges.",
      body: schema(taskDependencyReplaceInput),
      response: "Task",
    },
    "GET /api/projects/:id/progress": {
      description: "Project progress history.",
      response: "ProgressEntry[]",
    },
    "POST /api/projects/:id/progress": {
      description: "Submit or correct progress with current project version.",
      body: schema(progressInput),
      response: "Project",
    },
    "GET /api/projects/:id/files": {
      description: "List project file metadata.",
      response: "ProjectFile[]; use id and name to retrieve content.",
    },
    "POST /api/projects/:id/files": {
      description:
        "Upload a file as JSON with base64 data (no data URL prefix), up to 50 MB decoded; workspace attachment limit 256 MB.",
      body: schema(projectFileInput),
      response: "ProjectFile",
    },
    "GET /api/projects/:id/materials/:materialId": {
      description:
        "Read project attachment bytes. Pass the same Bearer header; response content type varies with the file.",
    },
    "GET /api/activities": {
      description: "Latest up to 500 workspace audit entries, newest first.",
      response: "Activity[]",
    },
    "POST /api/activity/query": {
      description: "Query activity pages.",
      body: schema(activityQueryInput),
      response: "ActivityPage",
    },
  };
  return {
    format: "pm-http-api-reference",
    version: 1,
    authentication: {
      header: "Authorization: Bearer <personal token>",
      permissions:
        "Current member permissions, across all projects in their workspace. Workspace identity is always resolved server-side. Admin-only operations still require the member to be an admin.",
      lifecycle:
        "Personal tokens remain valid until revoked or replaced. Disabled or activation-required accounts cannot use them. Role and workspace membership are checked on every request.",
      browserOnly:
        "Login/session/logout and personal token management use browser cookies and CSRF, not Bearer tokens.",
      csrf: "Bearer requests do not require cookies, Origin or x-csrf-token. If an Origin header is supplied it must be an allowed system origin for mutations.",
    },
    conventions: {
      request:
        "JSON with Content-Type: application/json, except GET/HEAD. Substitute :id path parameters with URL-encoded IDs returned by the API.",
      response:
        "Direct JSON values without a data envelope, except binary/export endpoints.",
      mutations:
        "Send idempotency-key: <UUID> for business mutations. Reuse the same UUID and exact payload after an ambiguous network failure. Same key with different method/path/body returns 409. Results replay for seven days.",
      versions:
        "Read the current version before editing. On 409, inspect current/conflicts and re-read; do not overwrite another member's updates blindly.",
      identity:
        "Use member IDs from /api/workspace when setting ownerId/assigneeId. Names alone do not establish identity.",
      limits:
        "General quota 300 requests/minute/IP; some routes are more restrictive and return 429. Ordinary JSON bodies max 2 MB; project-file uploads have their own limit. Respect Retry-After.",
      time: "Date-only fields use YYYY-MM-DD; timestamps use ISO 8601. Read settings.timeZone for calendar calculations.",
    },
    errors: {
      400: "Invalid payload; issues includes field paths.",
      401: "Missing, invalid or revoked token; reconnect via AI 接入.",
      403: "Insufficient permissions or disallowed request origin.",
      404: "Missing or inaccessible record.",
      409: "Version or idempotency conflict; current/conflicts may contain details.",
      429: "Rate limit; respect Retry-After.",
      500: "Server error; no success can be assumed.",
    },
    models: { Project: schema(projectSchema), Task: schema(taskSchema) },
    endpoints: routes.map((route) => ({
      ...route,
      ...(route.path.startsWith("/api/admin/")
        ? { requiresRole: "admin" }
        : {}),
      ...contracts[`${route.method} ${route.path}`],
      ...(contracts[`${route.method} ${route.path}`]
        ? {}
        : {
            description:
              "Additional existing PM endpoint; domain validation and member permissions apply. Core documented endpoints and the workspace snapshot cover ordinary project/task work.",
          }),
    })),
  };
}
