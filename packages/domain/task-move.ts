import { z } from "zod";
import {
  DomainError,
  validateGraph,
  type Project,
  type Task,
} from "./types.js";

export const taskMoveInput = z
  .object({
    version: z.number().int().positive(),
    parentId: z.string().min(1).max(100).nullable(),
    parentVersion: z.number().int().positive().optional(),
    anchorId: z.string().min(1).max(100).optional(),
    anchorVersion: z.number().int().positive().optional(),
    placement: z.enum(["before", "after", "last"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.parentId && !input.parentVersion)
      context.addIssue({
        code: "custom",
        path: ["parentVersion"],
        message: "The destination parent version is required.",
      });
    if (input.placement !== "last" && (!input.anchorId || !input.anchorVersion))
      context.addIssue({
        code: "custom",
        path: ["anchorId"],
        message: "A versioned placement anchor is required.",
      });
    if (input.placement === "last" && (input.anchorId || input.anchorVersion))
      context.addIssue({
        code: "custom",
        path: ["anchorId"],
        message: "Last placement cannot include an anchor.",
      });
  });
export type TaskMoveInput = z.infer<typeof taskMoveInput>;
export class TaskMoveConflict extends DomainError {
  constructor(public current: Task) {
    super("Tasks changed. Refresh the list and move the task again.");
  }
}
function siblingKey(task: Pick<Task, "projectId" | "parentId">) {
  return JSON.stringify([task.projectId, task.parentId]);
}
/** Legacy snapshots retain their existing sibling order; new tasks append. */
export function normalizeTaskOrder(tasks: readonly Task[]): Task[] {
  const next = new Map<string, number>();
  for (const task of tasks)
    if (task.sortOrder !== undefined)
      next.set(
        siblingKey(task),
        Math.max(next.get(siblingKey(task)) ?? 0, task.sortOrder + 1),
      );
  return tasks.map((task) => {
    if (task.sortOrder !== undefined) return task;
    const key = siblingKey(task),
      sortOrder = next.get(key) ?? 0;
    next.set(key, sortOrder + 1);
    return { ...task, sortOrder };
  });
}
export function nextTaskSortOrder(
  tasks: readonly Task[],
  projectId: string,
  parentId: string | null,
) {
  return normalizeTaskOrder(tasks).reduce(
    (next, task) =>
      task.projectId === projectId && task.parentId === parentId
        ? Math.max(next, task.sortOrder! + 1)
        : next,
    0,
  );
}
/** Reorder siblings in their existing slots, preserving other projects/groups. */
export function manualTaskOrder(tasks: readonly Task[]): Task[] {
  const normalized = normalizeTaskOrder(tasks),
    siblings = new Map<string, Task[]>();
  for (const task of normalized) {
    const key = siblingKey(task),
      rows = siblings.get(key) ?? [];
    rows.push(task);
    siblings.set(key, rows);
  }
  for (const rows of siblings.values())
    rows.sort((a, b) => a.sortOrder! - b.sortOrder!);
  const offsets = new Map<string, number>();
  return normalized.map((task) => {
    const key = siblingKey(task),
      offset = offsets.get(key) ?? 0;
    offsets.set(key, offset + 1);
    return siblings.get(key)![offset]!;
  });
}
export function planTaskMove(
  projects: Project[],
  tasks: readonly Task[],
  id: string,
  raw: TaskMoveInput,
  now = new Date().toISOString(),
): { before: Task; after: Task }[] {
  const input = taskMoveInput.parse(raw),
    normalized = normalizeTaskOrder(tasks);
  const byId = new Map(normalized.map((task) => [task.id, task]));
  const source = byId.get(id);
  if (!source) throw new DomainError("Task does not exist.");
  if (source.voided)
    throw new DomainError("Restore the task before moving it.");
  if (source.version !== input.version) throw new TaskMoveConflict(source);
  const parent = input.parentId ? byId.get(input.parentId) : undefined;
  if (
    input.parentId &&
    (!parent || parent.voided || parent.projectId !== source.projectId)
  )
    throw new DomainError(
      "The destination parent must be an active task in the same project.",
    );
  if (parent && parent.version !== input.parentVersion)
    throw new TaskMoveConflict(parent);
  const anchor = input.anchorId ? byId.get(input.anchorId) : undefined;
  if (
    input.anchorId &&
    (!anchor ||
      anchor.voided ||
      anchor.id === source.id ||
      anchor.projectId !== source.projectId ||
      anchor.parentId !== input.parentId)
  )
    throw new DomainError(
      "The placement anchor must be another active sibling in the same project.",
    );
  if (anchor && anchor.version !== input.anchorVersion)
    throw new TaskMoveConflict(anchor);
  const siblings = normalized
    .filter(
      (task) =>
        task.projectId === source.projectId && task.parentId === input.parentId,
    )
    .sort((left, right) => left.sortOrder! - right.sortOrder!);
  const reordered = siblings.filter((task) => task.id !== source.id);
  const index = anchor
    ? reordered.findIndex((task) => task.id === anchor.id) +
      (input.placement === "after" ? 1 : 0)
    : reordered.length;
  reordered.splice(index, 0, source);
  if (
    source.parentId === input.parentId &&
    siblings.every((task, index) => task.id === reordered[index]?.id)
  )
    return [];
  const updates = new Map<string, Task>();
  reordered.forEach((task, sortOrder) => {
    const parentId = task.id === source.id ? input.parentId : task.parentId;
    if (task.sortOrder !== sortOrder || task.parentId !== parentId)
      updates.set(task.id, {
        ...task,
        parentId,
        sortOrder,
        version: task.version + 1,
        updatedAt: now,
      });
  });
  // Moving the last/first child also changes the parents' aggregate semantics.
  if (source.parentId !== input.parentId)
    for (const parentId of [source.parentId, input.parentId]) {
      const current = parentId ? byId.get(parentId) : undefined;
      if (current && !updates.has(current.id))
        updates.set(current.id, {
          ...current,
          version: current.version + 1,
          updatedAt: now,
        });
    }
  validateGraph(
    projects,
    normalized.map((task) => updates.get(task.id) ?? task),
  );
  return [...updates.values()].map((after) => ({
    before: byId.get(after.id)!,
    after,
  }));
}
