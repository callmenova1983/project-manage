import { memberName } from "../../../../packages/domain/members";
import type { Member } from "../../../../packages/domain/types";
import {
  dayKey,
  weekKey,
  leafTasks,
  statuses,
  type Status,
  type Task,
} from "../../../../packages/domain/types";

export const taskScopes = ["today", "week", "all"] as const;
export const taskFocuses = ["all", "open", "done"] as const;
export type TaskScope = (typeof taskScopes)[number];
export type TaskFocus = (typeof taskFocuses)[number];
export interface TaskFilters {
  scope: TaskScope;
  status: Status | "";
  project: string;
  query: string;
  focus: TaskFocus;
}

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** URL state is the source of truth, including browser back/forward navigation. */
export function readTaskFilters(query: Record<string, unknown>): TaskFilters {
  const scope = queryString(query.scope);
  const status = queryString(query.status);
  const focus = queryString(query.focus);
  return {
    scope: taskScopes.includes(scope as TaskScope)
      ? (scope as TaskScope)
      : "week",
    status: statuses.includes(status as Status) ? (status as Status) : "",
    project: queryString(query.project),
    query: queryString(query.q),
    focus: taskFocuses.includes(focus as TaskFocus)
      ? (focus as TaskFocus)
      : "all",
  };
}

/** Determine leaves before filtering: an excluded child never turns its parent into work. */
export function filterTaskWork(
  tasks: Task[],
  filters: TaskFilters,
  now = new Date(),
  members: readonly Member[] = [],
): Task[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return leafTasks(tasks).filter(
    (task) =>
      (filters.scope === "all" ||
        (filters.scope === "today"
          ? task.workDates.includes(dayKey(now))
          : task.workWeek === weekKey(now))) &&
      (!filters.status || task.status === filters.status) &&
      (!filters.project || task.projectId === filters.project) &&
      (filters.focus === "all" ||
        (filters.focus === "done"
          ? task.status === "done"
          : task.status !== "done")) &&
      (!query ||
        `${task.title} ${memberName(task.assigneeId, task.assignee, members)}`
          .toLocaleLowerCase()
          .includes(query)),
  );
}
