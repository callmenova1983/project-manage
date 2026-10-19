import { taskDependenciesInput } from "./task-dependency-schema.js";
import { validateTaskDependencies } from "./task-dependencies.js";
import { validateTaskSchedule } from "./task-schedule.js";
import { progressArchiveInput } from "./progress-material.js";
import type { ProgressSource } from "./progress-material.js";
import { z } from "zod";
import {
  meetingSections,
  hasUnspecifiedOtherProject,
  meetingFactStatus,
  splitMeetingFollowup,
} from "./meeting-sections.js";
import {
  zonedDay,
  zonedWeek,
  workspaceSettingsInput,
  type WorkspaceSettings,
} from "./time-zone.js";
import { catalogsInput, type Catalogs } from "./admin.js";
import type { CompanyDirectory, ProjectMember } from "./directory.js";
import { projectLocationSchema } from "./project-location.js";
import { parseDailyReport } from "./daily-report.js";
export const stages = [
  "potential",
  "proposal",
  "approved",
  "implementation",
  "operations",
] as const;
export const statuses = ["todo", "in_progress", "done", "blocked"] as const;
export const disciplines = [
  "Sales",
  "Delivery",
  "Engineering",
  "Operations",
  "Unassigned",
] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid calendar date",
  );
export const projectInput = z
  .object({
    name: text(120),
    shortName: z.string().trim().max(80).optional(),
    channelId: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,49}$/)
      .optional(),
    intakeInbox: z.boolean().optional(),
    client: z.string().trim().max(120),
    description: z.string().max(4000),
    stage: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/),
    categoryIds: z
      .array(z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/))
      .max(20)
      .optional(),
    owner: z.string().trim().max(80),
    ownerId: z.string().min(1).max(100).nullable().optional(),
    participantIds: z.array(z.string().min(1).max(100)).max(50).optional(),
    discipline: z.enum(disciplines),
    latestUpdate: z.string().max(4000),
    notes: z.string().max(20000),
    aliases: z.array(text(80)).max(15),
    location: projectLocationSchema.nullable().optional(),
  })
  .strict();
export const taskInput = z
  .object({
    projectId: text(100),
    parentId: z.string().max(100).nullable(),
    title: text(240),
    description: z.string().max(4000),
    status: z.enum(statuses),
    assignee: z.string().trim().max(80),
    assigneeId: z.string().min(1).max(100).nullable().optional(),
    dueDate: dateSchema.nullable(),
    estimatedDate: dateSchema.nullable().optional(),
    reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
    workDates: z.array(dateSchema).max(31),
    workWeek: dateSchema.nullable(),
    scheduleStart: dateSchema.nullable().optional(),
    scheduleEnd: dateSchema.nullable().optional(),
    milestone: z.boolean().optional(),
    dependencies: taskDependenciesInput.optional(),
  })
  .strict();
export const projectSchema = projectInput.extend({
  reportedAt: z.string().datetime().nullable().default(null),
  reportedBy: z.string().max(80).nullable().default(null),
  id: text(100),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export const taskSchema = taskInput.extend({
  sortOrder: z.number().int().nonnegative().optional(),
  voided: z
    .object({
      at: z.string().datetime(),
      actor: text(100),
      actorId: text(100),
      reason: text(500),
      batchId: text(100),
    })
    .strict()
    .nullable()
    .optional(),
  id: text(100),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type ProjectInput = z.infer<typeof projectInput>;
export type TaskInput = z.infer<typeof taskInput>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Status = (typeof statuses)[number];
export type Stage = string;
export interface Actor {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  role?: "member" | "admin";
}
export interface Activity {
  id: string;
  projectId: string | null;
  /** Preserve the original audit grouping when a project is merged. */
  originalProjectId?: string;
  entityId: string;
  kind: "project" | "task" | "import" | "proposal";
  action: string;
  actor: string;
  actorId?: string;
  createdAt: string;
  source: string;
  progressSource?: ProgressSource;
  before: Project | Task | null;
  after: Project | Task | null;
}
export interface Snapshot {
  schemaVersion: 1 | 2 | 3;
  catalogs?: Catalogs;
  settings?: WorkspaceSettings;
  members?: Member[];
  revision: number;
  projects: Project[];
  tasks: Task[];
  activities: Activity[];
  directory?: CompanyDirectory;
  projectMembers?: ProjectMember[];
  projectOrder?: string[];
}
export interface Member {
  id: string;
  name: string;
  email: string;
  status: "active" | "disabled" | "pending";
}
export const snapshotImport = z.object({
  ...progressArchiveInput.shape,
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  catalogs: catalogsInput.optional(),
  settings: workspaceSettingsInput.optional(),
  projects: z.array(projectSchema).max(1000),
  tasks: z.array(taskSchema).max(10000),
  projectOrder: z.array(text(100)).max(1000).optional(),
});
export interface Suggestion {
  id: string;
  sourceLine: number;
  sourceText: string;
  sourceHeading?: string;
  title: string;
  candidates: { projectId: string; reason: string }[];
  selectedProjectId: string;
  action: "task" | "update";
  status: Status;
  confirmed: boolean;
  overwriteConfirmed: boolean;
  /** Source-derived daily-report attribution; never replaced by the submitter. */
  dailyReport?: boolean;
  reporter?: string;
  reportTo?: string;
  workDate?: string;
  invalidWorkDate?: true;
  assignee?: string;
}
export interface Proposal {
  id: string;
  source: string;
  originalSource?: import("./capture.js").CaptureSource;
  sourceVersion: 1;
  status: "draft" | "applied";
  suggestions: Suggestion[];
  createdAt: string;
  appliedAt?: string;
  appliedSuggestionIds?: string[];
  skippedSuggestionIds?: string[];
  /** Persist exact destinations; titles are not unique identifiers. */
  appliedResults?: {
    suggestionId: string;
    projectId: string;
    taskId?: string;
    taskDisposition?: "created" | "linked";
  }[];
  createdProjectIds?: string[];
  generator?: {
    provider: "qwen";
    model: string;
    region: string;
    promptVersion: number;
  };
}
export interface AiCapabilities {
  enabled: boolean;
  runtime?: "legacy" | "sdk" | null;
  provider: "rules" | "qwen";
  model: string | null;
  region: string | null;
  connectionVerified: false;
  remainingAttempts: number;
  availabilityReason?: "disabled" | "expired" | "exhausted" | null;
  expiresAt?: string | null;
}
export function dayKey(date = new Date(), timeZone = "UTC"): string {
  return timeZone === "UTC"
    ? date.toISOString().slice(0, 10)
    : zonedDay(date, timeZone);
}
export function weekKey(date = new Date(), timeZone = "UTC"): string {
  if (timeZone !== "UTC") return zonedWeek(date, timeZone);
  const d = new Date(dayKey(date) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(d);
}
export function leafTasks(tasks: Task[]): Task[] {
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  return tasks.filter((t) => !t.voided && !parents.has(t.id));
}
export function statistics(
  tasks: Task[],
  scope: "all" | "week" | "today" = "all",
  date = new Date(),
  timeZone = "UTC",
) {
  const day = scope === "today" ? dayKey(date, timeZone) : "";
  const week = scope === "week" ? weekKey(date, timeZone) : "";
  const leaves = leafTasks(tasks).filter(
    (t) =>
      scope === "all" ||
      (scope === "today" ? t.workDates.includes(day) : t.workWeek === week),
  );
  return {
    total: leaves.length,
    done: leaves.filter((t) => t.status === "done").length,
    todo: leaves.filter((t) => t.status === "todo").length,
    in_progress: leaves.filter((t) => t.status === "in_progress").length,
    blocked: leaves.filter((t) => t.status === "blocked").length,
    unfinished: leaves.filter((t) => t.status !== "done").length,
  };
}
export class DomainError extends Error {}
export function validateGraph(projects: Project[], tasks: Task[]): void {
  const ids = new Set(projects.map((p) => p.id));
  if (
    ids.size !== projects.length ||
    new Set(tasks.map((t) => t.id)).size !== tasks.length
  )
    throw new DomainError("Duplicate identifiers");
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const scheduleParents = new Set(
    tasks.map((task) => task.parentId).filter(Boolean),
  );
  for (const t of tasks) {
    validateTaskSchedule(t);
    if (
      scheduleParents.has(t.id) &&
      (t.scheduleStart || t.scheduleEnd || t.milestone)
    )
      throw new DomainError(
        "Parent tasks use aggregate schedules. Clear their independent schedule before adding subtasks.",
      );
    if (!ids.has(t.projectId))
      throw new DomainError("Task project does not exist");
    if (t.workDates.some((d) => weekKey(new Date(d)) !== t.workWeek))
      throw new DomainError("Work days must be inside the selected work week");
    const seen = new Set([t.id]);
    let p = t.parentId;
    while (p) {
      const parent = byId.get(p);
      if (!parent || parent.projectId !== t.projectId)
        throw new DomainError("Parent must belong to the same project");
      if (!t.voided && parent.voided)
        throw new DomainError("请先恢复上级任务，再恢复或添加子任务。");
      if (seen.has(p)) throw new DomainError("Circular task hierarchy");
      if (seen.size >= 20)
        throw new DomainError("Task nesting is limited to 20 levels");
      seen.add(p);
      p = parent.parentId;
    }
  }
  validateTaskDependencies(tasks);
}
export function suggest(source: string, projects: Project[]): Suggestion[] {
  const report = parseDailyReport(source);
  if (report) {
    return report.map(({ contextText, ...entry }, index) => {
      const matches = (text: string) =>
        projects
          .filter(
            (p) =>
              !p.intakeInbox &&
              [p.name, p.shortName ?? "", ...p.aliases]
                .filter(Boolean)
                .some((name) =>
                  text.toLowerCase().includes(name.toLowerCase()),
                ),
          )
          .map((p) => ({
            projectId: p.id,
            reason: "Project name or alias appears in daily report",
          }));
      const direct = matches(entry.sourceText);
      const candidates = direct.length
        ? direct
        : matches(contextText ?? entry.sourceText);
      return {
        ...entry,
        id: `report-${entry.sourceLine}-${index + 1}`,
        dailyReport: true,
        candidates,
        selectedProjectId:
          candidates.length === 1 ? candidates[0]!.projectId : "",
        confirmed: false,
        overwriteConfirmed: false,
      };
    });
  }
  return (
    meetingSections(source)
      .filter((entry) => !entry.isHeading)
      .map((entry) => ({
        line: entry.text,
        i: entry.sourceLine - 1,
        heading: entry.heading,
      }))
      // assembleCaptureText adds filename-only source headings. They identify
      // provenance, not work items; preserve original line numbers below.
      .filter(
        (x) =>
          x.line.trim() &&
          !/^【[^\n]+\.(?:txt|csv|tsv|md|log|json|xlsx?|docx?|pptx?|pdf|png|jpe?g|webp|gif)】$/i.test(
            x.line.trim(),
          ),
      )
      .map(({ line, i, heading }) => {
        const factStatus = heading ? meetingFactStatus(line) : undefined;
        const lower = line.toLowerCase();
        let candidates = projects
          .filter((p) =>
            [p.name, p.shortName ?? "", ...p.aliases]
              .filter(Boolean)
              .some((n) => lower.includes(n.toLowerCase())),
          )
          .map((p) => ({
            projectId: p.id,
            reason: "Project name or alias appears in source",
          }));
        const unspecifiedProject = hasUnspecifiedOtherProject(line);
        if (heading && unspecifiedProject) candidates = [];
        if (!candidates.length && heading && !unspecifiedProject) {
          candidates = projects
            .filter(
              (p) =>
                !p.intakeInbox &&
                [p.name, p.shortName ?? "", ...p.aliases]
                  .filter(Boolean)
                  .some((name) =>
                    heading.toLowerCase().includes(name.toLowerCase()),
                  ),
            )
            .map((p) => ({
              projectId: p.id,
              reason: "Project name or alias appears in section heading",
            }));
        }
        return {
          id: `line-${i + 1}`,
          sourceLine: i + 1,
          sourceText: line,
          ...(heading
            ? {
                sourceHeading: unspecifiedProject
                  ? "其他项目（需明确）"
                  : heading,
              }
            : {}),
          title: line.replace(/^[-*]\s*/, "").slice(0, 240),
          candidates,
          selectedProjectId:
            candidates.length === 1 ? candidates[0]!.projectId : "",
          action: factStatus ? ("update" as const) : ("task" as const),
          status:
            factStatus ??
            (/\b(done|completed)\b/i.test(line)
              ? ("done" as const)
              : ("todo" as const)),
          confirmed: false,
          overwriteConfirmed: false,
        };
      })
      .flatMap<Suggestion>((item) => {
        const split = item.sourceHeading && splitMeetingFollowup(item.title);
        if (!split) return [item];
        return [
          {
            ...item,
            title: split.fact,
            action: "update" as const,
            status: meetingFactStatus(split.fact) ?? ("in_progress" as const),
          },
          {
            ...item,
            id: `${item.id}-followup`,
            title: split.followup,
            action: "task" as const,
            status: "todo" as const,
          },
        ];
      })
  );
}
export function parsePaste(
  source: string,
): { title: string; assignee: string; dueDate: string | null }[] {
  return source
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [title, assignee, due] = l.split("\t");
      return {
        title: title!.replace(/^[-*]\s*/, "").trim(),
        assignee: assignee?.trim() || "Unassigned",
        dueDate: due?.trim() || null,
      };
    });
}

export const noteDateInput = z
  .object({
    projectVersion: z.number().int().positive(),
    sourceLine: z.number().int().positive(),
    taskId: text(100),
    taskVersion: z.number().int().positive(),
    dueDate: dateSchema,
    confirmed: z.literal(true),
    overwriteConfirmed: z.boolean(),
  })
  .strict();
export type NoteDateInput = z.infer<typeof noteDateInput>;
export function noteDateCandidates(notes: string) {
  const lines = notes.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const match = line.match(
      /\b(?:\d{4}-\d{2}-\d{2}|tomorrow|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
    );
    return match
      ? [
          {
            sourceLine: index + 1,
            sourceText: line,
            context: lines.slice(Math.max(0, index - 1), index + 2).join("\n"),
            proposedDate: dateSchema.safeParse(match[0]).success
              ? match[0]
              : "",
            phrase: match[0],
          },
        ]
      : [];
  });
}
