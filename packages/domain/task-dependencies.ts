import { Temporal } from "@js-temporal/polyfill";
import { DomainError, type Task } from "./types.js";
import {
  taskDependenciesInput,
  taskDependencyReplaceInput,
  type TaskDependency,
  type TaskDependencyReplace,
} from "./task-dependency-schema.js";
export {
  taskDependencyInput,
  taskDependenciesInput,
  taskDependencyReplaceInput,
  type TaskDependency,
  type TaskDependencyReplace,
} from "./task-dependency-schema.js";
export function validateTaskDependencies(tasks: readonly Task[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  const indegrees = new Map(tasks.map((task) => [task.id, 0]));
  const successors = new Map<string, string[]>();
  for (const task of tasks) {
    const edges = taskDependenciesInput.parse(task.dependencies ?? []);
    if (new Set(edges.map((edge) => edge.taskId)).size !== edges.length)
      throw new DomainError("Choose each predecessor once.");
    if (edges.length && parents.has(task.id))
      throw new DomainError(
        "Clear dependencies before turning a task into a parent.",
      );
    for (const edge of edges) {
      if (edge.taskId === task.id)
        throw new DomainError("A task cannot depend on itself.");
      const predecessor = byId.get(edge.taskId);
      if (!predecessor || predecessor.projectId !== task.projectId)
        throw new DomainError(
          "A predecessor task is unavailable in this project.",
        );
      if (parents.has(predecessor.id))
        throw new DomainError("Dependencies may only connect leaf tasks.");
      indegrees.set(task.id, indegrees.get(task.id)! + 1);
      const rows = successors.get(predecessor.id) ?? [];
      rows.push(task.id);
      successors.set(predecessor.id, rows);
    }
  }
  const queue = tasks
    .filter((task) => indegrees.get(task.id) === 0)
    .map((task) => task.id);
  let processed = 0;
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    processed++;
    for (const successor of successors.get(id) ?? []) {
      const degree = indegrees.get(successor)! - 1;
      indegrees.set(successor, degree);
      if (!degree) queue.push(successor);
    }
  }
  if (processed !== tasks.length)
    throw new DomainError("Task dependencies cannot contain a cycle.");
}
export function taskDependencyWarnings(tasks: readonly Task[]) {
  validateTaskDependencies(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const result: {
    taskId: string;
    predecessorId: string;
    kind: "voided" | "unscheduled" | "date_conflict";
    earliestStart?: string;
  }[] = [];
  for (const task of tasks) {
    if (task.voided) continue;
    for (const edge of task.dependencies ?? []) {
      const predecessor = byId.get(edge.taskId)!;
      if (predecessor.voided)
        result.push({
          taskId: task.id,
          predecessorId: predecessor.id,
          kind: "voided",
        });
      else if (
        !task.scheduleStart ||
        !task.scheduleEnd ||
        !predecessor.scheduleStart ||
        !predecessor.scheduleEnd
      )
        result.push({
          taskId: task.id,
          predecessorId: predecessor.id,
          kind: "unscheduled",
        });
      else if (task.scheduleStart <= predecessor.scheduleEnd)
        result.push({
          taskId: task.id,
          predecessorId: predecessor.id,
          kind: "date_conflict",
          earliestStart: Temporal.PlainDate.from(predecessor.scheduleEnd)
            .add({ days: 1 })
            .toString(),
        });
    }
  }
  return result.sort(
    (a, b) =>
      a.taskId.localeCompare(b.taskId) ||
      a.predecessorId.localeCompare(b.predecessorId),
  );
}
export class TaskDependencyConflict extends Error {
  constructor(
    message: string,
    public current: Task,
  ) {
    super(message);
  }
}
export function planTaskDependencies(
  tasks: readonly Task[],
  id: string,
  raw: TaskDependencyReplace,
  now = new Date(),
) {
  const input = taskDependencyReplaceInput.parse(raw);
  const before = tasks.find((task) => task.id === id);
  if (!before) throw new DomainError("Task unavailable in this workspace.");
  if (before.version !== input.version)
    throw new TaskDependencyConflict(
      "Task dependencies changed. Reload the latest version.",
      before,
    );
  if (before.voided)
    throw new DomainError(
      "Restore a voided task before changing its dependencies.",
    );
  const after: Task = {
    ...before,
    dependencies: input.dependencies,
    version: before.version + 1,
    updatedAt: now.toISOString(),
  };
  validateTaskDependencies(
    tasks.map((task) => (task.id === id ? after : task)),
  );
  const key = (edges: readonly TaskDependency[]) =>
    JSON.stringify([...edges].sort((a, b) => a.taskId.localeCompare(b.taskId)));
  return key(before.dependencies ?? []) === key(input.dependencies)
    ? null
    : { before, after };
}
