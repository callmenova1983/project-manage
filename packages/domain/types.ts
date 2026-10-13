import { progressArchiveInput } from "./progress-material.js";
import type { ProgressSource } from "./progress-material.js";
import { z } from "zod";
import { catalogsInput, type Catalogs } from "./admin.js";
import type { CompanyDirectory, ProjectMember } from "./directory.js";
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
    discipline: z.enum(disciplines),
    latestUpdate: z.string().max(4000),
    notes: z.string().max(20000),
    aliases: z.array(text(80)).max(15),
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
    dueDate: dateSchema.nullable(),
    estimatedDate: dateSchema.nullable().optional(),
    reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
    workDates: z.array(dateSchema).max(31),
    workWeek: dateSchema.nullable(),
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
  createdAt: string;
  source: string;
  progressSource?: ProgressSource;
  before: Project | Task | null;
  after: Project | Task | null;
}
export interface Snapshot {
  schemaVersion: 1 | 2;
  catalogs?: Catalogs;
  revision: number;
  projects: Project[];
  tasks: Task[];
  activities: Activity[];
  directory?: CompanyDirectory;
  projectMembers?: ProjectMember[];
  projectOrder?: string[];
}
export const snapshotImport = z.object({
  ...progressArchiveInput.shape,
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  catalogs: catalogsInput.optional(),
  projects: z.array(projectSchema).max(1000),
  tasks: z.array(taskSchema).max(10000),
  projectOrder: z.array(text(100)).max(1000).optional(),
});
export interface Suggestion {
  id: string;
  sourceLine: number;
  sourceText: string;
  title: string;
  candidates: { projectId: string; reason: string }[];
  selectedProjectId: string;
  action: "task" | "update";
  status: Status;
  confirmed: boolean;
  overwriteConfirmed: boolean;
}
export interface Proposal {
  id: string;
  source: string;
  sourceVersion: 1;
  status: "draft" | "applied";
  suggestions: Suggestion[];
  createdAt: string;
  appliedAt?: string;
  generator?: {
    provider: "qwen";
    model: string;
    region: string;
    promptVersion: 1;
  };
}
export interface AiCapabilities {
  enabled: boolean;
  provider: "rules" | "qwen";
  model: string | null;
  region: string | null;
  connectionVerified: false;
  remainingAttempts: number;
}
export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
export function weekKey(date = new Date()): string {
  const d = new Date(dayKey(date) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayKey(d);
}
export function leafTasks(tasks: Task[]): Task[] {
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  return tasks.filter((t) => !parents.has(t.id));
}
export function statistics(
  tasks: Task[],
  scope: "all" | "week" | "today" = "all",
  date = new Date(),
) {
  const leaves = leafTasks(tasks).filter(
    (t) =>
      scope === "all" ||
      (scope === "today"
        ? t.workDates.includes(dayKey(date))
        : t.workWeek === weekKey(date)),
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
  for (const t of tasks) {
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
      if (seen.has(p)) throw new DomainError("Circular task hierarchy");
      if (seen.size >= 20)
        throw new DomainError("Task nesting is limited to 20 levels");
      seen.add(p);
      p = parent.parentId;
    }
  }
}
export function suggest(source: string, projects: Project[]): Suggestion[] {
  return source
    .split(/\r?\n/)
    .map((line, i) => ({ line, i }))
    .filter((x) => x.line.trim())
    .map(({ line, i }) => {
      const lower = line.toLowerCase();
      const candidates = projects
        .filter((p) =>
          [p.name, ...p.aliases].some((n) => lower.includes(n.toLowerCase())),
        )
        .map((p) => ({
          projectId: p.id,
          reason: "Project name or alias appears in source",
        }));
      return {
        id: `line-${i + 1}`,
        sourceLine: i + 1,
        sourceText: line,
        title: line.replace(/^[-*]\s*/, "").slice(0, 240),
        candidates,
        selectedProjectId:
          candidates.length === 1 ? candidates[0]!.projectId : "",
        action: "task" as const,
        status: /\b(done|completed)\b/i.test(line)
          ? ("done" as const)
          : ("todo" as const),
        confirmed: false,
        overwriteConfirmed: false,
      };
    });
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
