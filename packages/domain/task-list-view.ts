import { taskAssigneeKey } from "./task-view.js";
import { manualTaskOrder } from "./task-move.js";
import type { Task } from "./types.js";
export type TaskListGroup = "none" | "project" | "assignee" | "status";
export type TaskListSort = "manual" | "due" | "updated" | "title";
export function taskListGroups(
  tasks: readonly Task[],
  group: TaskListGroup,
  sort: TaskListSort,
) {
  const seen = new Set<string>();
  const ordered = (sort === "manual" ? manualTaskOrder(tasks) : tasks).filter(
    (task) => {
      if (task.voided || seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    },
  );
  if (sort !== "manual")
    ordered.sort((a, b) => {
      const difference =
        sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "updated"
            ? b.updatedAt.localeCompare(a.updatedAt)
            : a.dueDate && b.dueDate
              ? a.dueDate.localeCompare(b.dueDate)
              : a.dueDate
                ? -1
                : b.dueDate
                  ? 1
                  : 0;
      return difference || a.id.localeCompare(b.id);
    });
  const groups = new Map<string, Task[]>();
  for (const task of ordered) {
    const key =
      group === "project"
        ? task.projectId
        : group === "assignee"
          ? taskAssigneeKey(task)
          : group === "status"
            ? task.status
            : "all";
    const rows = groups.get(key) ?? [];
    rows.push(task);
    groups.set(key, rows);
  }
  return [...groups].map(([key, tasks]) => ({ key, tasks }));
}
/** Stable tree traversal is linear and tolerates malformed cycles without recursion. */
export function orderTaskTree(tasks: readonly Task[]): Task[] {
  const active = tasks.filter((task) => !task.voided);
  const ids = new Set(active.map((task) => task.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of active) {
    if (!task.parentId || !ids.has(task.parentId)) roots.push(task);
    else {
      const rows = children.get(task.parentId) ?? [];
      rows.push(task);
      children.set(task.parentId, rows);
    }
  }
  const result: Task[] = [],
    visited = new Set<string>();
  const visit = (roots: readonly Task[]) => {
    const stack = [...roots].reverse();
    while (stack.length) {
      const task = stack.pop()!;
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      result.push(task);
      const rows = children.get(task.id) ?? [];
      for (let i = rows.length - 1; i >= 0; i--) stack.push(rows[i]!);
    }
  };
  visit(roots);
  visit(active);
  return result;
}
