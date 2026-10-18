import { z } from "zod";
import {
  dateSchema,
  statuses,
  taskSchema,
  type Task,
  type Member,
} from "./types.js";
import { taskMember } from "./members.js";

export const taskBulkUpdateInput = z
  .object({
    targets: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (targets) =>
          new Set(targets.map((target) => target.id)).size === targets.length,
        "Choose each task once.",
      ),
    change: z.discriminatedUnion("field", [
      z
        .object({ field: z.literal("status"), value: z.enum(statuses) })
        .strict(),
      z
        .object({
          field: z.literal("assignee"),
          value: z
            .object({
              assigneeId: z.string().min(1).max(100).nullable(),
              assignee: z.string().trim().max(80),
            })
            .strict(),
        })
        .strict(),
      z
        .object({ field: z.literal("dueDate"), value: dateSchema.nullable() })
        .strict(),
    ]),
  })
  .strict();
export type TaskBulkUpdate = z.infer<typeof taskBulkUpdateInput>;
export const taskBulkConflictsInput = z
  .array(
    z
      .object({
        id: z.string(),
        reason: z.string(),
        currentVersion: z.number().int().positive().nullable(),
      })
      .strict(),
  )
  .max(100);
export type TaskBulkConflictItem = z.infer<
  typeof taskBulkConflictsInput
>[number];
export class TaskBulkConflict extends Error {
  constructor(public conflicts: TaskBulkConflictItem[]) {
    super("Some selected tasks changed. Review the conflicts before retrying.");
  }
}
export function planTaskBulkUpdate(
  tasks: readonly Task[],
  members: readonly Member[],
  raw: TaskBulkUpdate,
  now = new Date(),
) {
  const input = taskBulkUpdateInput.parse(raw);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  const conflicts: TaskBulkConflictItem[] = [];
  for (const target of input.targets) {
    const task = byId.get(target.id);
    const reason = !task
      ? "Task unavailable in this workspace."
      : task.version !== target.version
        ? "Task version changed."
        : task.voided
          ? "Restore a voided task before editing it."
          : parents.has(task.id)
            ? "Choose leaf tasks only."
            : "";
    if (reason)
      conflicts.push({
        id: target.id,
        reason,
        currentVersion: task?.version ?? null,
      });
  }
  if (conflicts.length) throw new TaskBulkConflict(conflicts);
  const changes: { before: Task; after: Task }[] = [];
  const confirmed: Task[] = [];
  for (const target of input.targets) {
    const before = byId.get(target.id)!;
    const change = input.change;
    let candidate: Task;
    if (change.field === "assignee")
      candidate = taskMember({ ...before, ...change.value }, members, before);
    else candidate = { ...before, [change.field]: change.value };
    const same =
      change.field === "assignee"
        ? candidate.assignee === before.assignee &&
          (candidate.assigneeId ?? null) === (before.assigneeId ?? null)
        : candidate[change.field] === before[change.field];
    if (same) {
      confirmed.push(before);
      continue;
    }
    const after = taskSchema.parse({
      ...candidate,
      version: before.version + 1,
      updatedAt: now.toISOString(),
    });
    changes.push({ before, after });
    confirmed.push(after);
  }
  return { changes, confirmed, field: input.change.field };
}
