import type { Task, Status } from "./types.js";
export const taskBoardColumns = [
  "todo",
  "in_progress",
  "blocked",
  "done",
] as const;
export function taskBoardRows(tasks: readonly Task[]) {
  const rows: Record<Status, Task[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    done: [],
  };
  const seen = new Set<string>();
  for (const task of tasks)
    if (!task.voided && !seen.has(task.id)) {
      seen.add(task.id);
      rows[task.status].push(task);
    }
  for (const column of taskBoardColumns)
    rows[column].sort(
      (a, b) =>
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.id.localeCompare(b.id),
    );
  return rows;
}
