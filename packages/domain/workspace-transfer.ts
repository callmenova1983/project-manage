import { z } from "zod";
import {
  projectSchema,
  taskSchema,
  dateSchema,
  snapshotImport,
  validateGraph,
  type Snapshot,
  type Activity,
  type Project,
  type Task,
} from "./types.js";
import { progressSourceSchema } from "./progress-material.js";
import { dailyLogRow } from "./daily-log.js";
import { defaultCatalogs, importCatalogs, type Catalogs } from "./admin.js";
import { channelEntries } from "./channels.js";
import { projectMembers, taskMember } from "./members.js";
import { retainTaskSchedule } from "./task-schedule.js";

const identifier = z.string().min(1).max(160);
const sourceWithoutFiles = progressSourceSchema.extend({
  materialIds: z.array(z.string().uuid()).max(0),
});
export const activityArchiveSchema = z
  .object({
    id: identifier,
    importedFromId: identifier.optional(),
    projectId: identifier.nullable(),
    originalProjectId: identifier.optional(),
    entityId: identifier,
    kind: z.enum(["project", "task", "import", "proposal"]),
    action: z.string().max(4000),
    actor: z.string().max(100),
    actorId: identifier.optional(),
    createdAt: z.string().datetime(),
    source: z.string().max(20000),
    progressSource: sourceWithoutFiles.optional(),
    before: z.union([projectSchema, taskSchema]).nullable(),
    after: z.union([projectSchema, taskSchema]).nullable(),
  })
  .strict();
export const dailyLogArchiveSchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().min(1).max(12000),
    workDate: dateSchema,
    reporter: z.string().min(1).max(80),
    createdAt: z.string().datetime(),
    rows: z
      .array(dailyLogRow.extend({ status: z.enum(["recorded", "pending"]) }))
      .max(100),
  })
  .strict();
export const workspaceDataArchive = snapshotImport
  .omit({ progressFiles: true, progressArchive: true })
  .extend({
    format: z.literal("project-manage-data"),
    formatVersion: z.literal(1),
    exportedAt: z.string().datetime(),
    activities: z.array(activityArchiveSchema).max(100000),
    dailyLogs: z.array(dailyLogArchiveSchema).max(10000),
  })
  .strict();
export type WorkspaceDataArchive = z.infer<typeof workspaceDataArchive>;
export type DataImportCounts = {
  added: number;
  updated: number;
  unchanged: number;
};
export interface WorkspaceDataImportReceipt {
  projects: DataImportCounts;
  tasks: DataImportCounts;
  activitiesAdded: number;
  dailyLogsImported: number;
  unlinkedAssignments: number;
}
export interface WorkspaceDataImportResult {
  snapshot: Snapshot;
  receipt: WorkspaceDataImportReceipt;
}

/** Explicit whitelist: no attachment bytes, image data, file references, accounts or credentials. */
export function createWorkspaceDataArchive(
  snapshot: Snapshot,
  activities: Activity[] = snapshot.activities,
  dailyLogs: z.infer<typeof dailyLogArchiveSchema>[] = [],
): WorkspaceDataArchive {
  return workspaceDataArchive.parse({
    format: "project-manage-data",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    schemaVersion: 3,
    catalogs: snapshot.catalogs ?? defaultCatalogs,
    settings: snapshot.settings,
    projects: snapshot.projects,
    tasks: snapshot.tasks,
    projectOrder: snapshot.projectOrder,
    activities: activities.map((event) => ({
      ...event,
      id: event.importedFromId ?? event.id,
      ...(event.progressSource
        ? { progressSource: { ...event.progressSource, materialIds: [] } }
        : {}),
    })),
    dailyLogs,
  });
}
function mergeCatalog(current: Catalogs, incoming?: Catalogs): Catalogs {
  if (!incoming) return current;
  const append = <T extends { id: string }>(old: T[], next: T[]) => [
    ...old,
    ...next.filter(
      (entry) => !old.some((existing) => existing.id === entry.id),
    ),
  ];
  return {
    ...current,
    stages: append(current.stages, incoming.stages),
    categories: append(current.categories, incoming.categories),
    channels: append(channelEntries(current), channelEntries(incoming)),
  };
}
function equivalent(left: Project | Task, right: Project | Task) {
  const content = (record: Project | Task) =>
    "projectId" in record
      ? taskSchema
          .omit({ version: true, updatedAt: true })
          .strip()
          .parse(record)
      : projectSchema
          .omit({ version: true, updatedAt: true })
          .strip()
          .parse(record);
  return JSON.stringify(content(left)) === JSON.stringify(content(right));
}
export function planWorkspaceDataImport(
  current: Snapshot,
  raw: unknown,
  isAdmin: boolean,
) {
  const input = workspaceDataArchive.parse(raw);
  validateGraph(input.projects, input.tasks);
  const members = new Map(
    (current.members ?? []).map((member) => [member.id, member]),
  );
  let unlinkedAssignments = 0;
  const projects = input.projects.map((project) => {
    const old = current.projects.find((p) => p.id === project.id);
    const known = (id: string) =>
      members.has(id) &&
      (members.get(id)!.status === "active" ||
        old?.ownerId === id ||
        old?.participantIds?.includes(id));
    const ownerId =
      project.ownerId && !known(project.ownerId)
        ? (unlinkedAssignments++, null)
        : project.ownerId;
    const participantIds = project.participantIds?.filter(
      (id) => known(id) || (unlinkedAssignments++, false),
    );
    return projectMembers(
      { ...project, ownerId, participantIds },
      [...members.values()],
      old,
    );
  });
  const tasks = input.tasks.map((task) => {
    const old = current.tasks.find((t) => t.id === task.id);
    const linked =
      task.assigneeId &&
      members.has(task.assigneeId) &&
      (members.get(task.assigneeId)!.status === "active" ||
        old?.assigneeId === task.assigneeId);
    const next =
      task.assigneeId && !linked
        ? (unlinkedAssignments++, { ...task, assigneeId: null })
        : task;
    return taskMember(
      retainTaskSchedule(
        { ...next, sortOrder: next.sortOrder ?? old?.sortOrder },
        old,
      ),
      [...members.values()],
      old,
    );
  });
  const now = new Date().toISOString();
  const merge = <T extends Project | Task>(old: T[], incoming: T[]) => {
    const counts: DataImportCounts = { added: 0, updated: 0, unchanged: 0 };
    const changes: T[] = [];
    const result = new Map(old.map((item) => [item.id, item]));
    for (const item of incoming) {
      const previous = result.get(item.id);
      if (previous && equivalent(previous, item)) {
        counts.unchanged++;
        continue;
      }
      counts[previous ? "updated" : "added"]++;
      const next = {
        ...item,
        version: Math.max(item.version, previous?.version ?? 0) + 1,
        updatedAt: now,
      };
      result.set(item.id, next);
      changes.push(next);
    }
    return { all: [...result.values()], changes, counts };
  };
  const projectPlan = merge(current.projects, projects),
    taskPlan = merge(current.tasks, tasks);
  validateGraph(projectPlan.all, taskPlan.all);
  const catalogs = importCatalogs(
    {
      schemaVersion: 3,
      catalogs: mergeCatalog(
        current.catalogs ?? defaultCatalogs,
        input.catalogs,
      ),
      projects: projectPlan.all,
    },
    current.catalogs ?? defaultCatalogs,
    isAdmin,
  );
  const projectIds = new Set(projectPlan.all.map((project) => project.id));
  for (const batch of input.dailyLogs)
    for (const row of batch.rows)
      if (row.projectId && !projectIds.has(row.projectId))
        throw new Error("日志引用了不存在的项目，请检查导入文件。");
  const projectOrder = [
    ...new Set([
      ...(current.projectOrder ?? current.projects.map((p) => p.id)),
      ...(input.projectOrder ?? projects.map((p) => p.id)),
      ...projectPlan.all.map((p) => p.id),
    ]),
  ].filter((id) => projectIds.has(id));
  return {
    input,
    projects: projectPlan,
    tasks: taskPlan,
    catalogs,
    projectOrder,
    unlinkedAssignments,
  };
}
