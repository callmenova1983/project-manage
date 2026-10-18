import type { Task } from "./types.js";

/** Whole-workspace replacement is distinct from restoring an old audit record. */
export function normalizeImportedTaskPlanning<
  T extends { schemaVersion: 1 | 2 | 3; tasks: Task[] },
>(input: T): T {
  return {
    ...input,
    tasks: input.tasks.map((task) => ({
      ...task,
      scheduleStart:
        input.schemaVersion === 3 ? (task.scheduleStart ?? null) : null,
      scheduleEnd:
        input.schemaVersion === 3 ? (task.scheduleEnd ?? null) : null,
      milestone: input.schemaVersion === 3 ? (task.milestone ?? false) : false,
      dependencies: input.schemaVersion === 3 ? (task.dependencies ?? []) : [],
    })),
  };
}
