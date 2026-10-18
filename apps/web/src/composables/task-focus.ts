import {
  createTaskViewIndex,
  type TaskViewQuery,
} from "../../../../packages/domain/task-view";
import type { Member } from "../../../../packages/domain/types";
import {
  statuses,
  type Status,
  type Task,
} from "../../../../packages/domain/types";

export const taskScopes = ["today", "week", "all"] as const;
export const taskFocuses = ["all", "open", "done"] as const;
export type TaskScope = (typeof taskScopes)[number];
export type TaskFocus = (typeof taskFocuses)[number];
export const taskStates = [
  "all",
  "open",
  "todo",
  "in_progress",
  "blocked",
  "done",
] as const;
export type TaskState = (typeof taskStates)[number];
export type TaskFilters = TaskViewQuery;

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** URL state is the source of truth, including browser back/forward navigation. */
export function readTaskFilters(query: Record<string, unknown>): TaskFilters {
  const scope = queryString(query.scope);
  const status = queryString(query.status);
  const focus = queryString(query.focus);
  const selectedStatus = statuses.includes(status as Status)
    ? (status as Status)
    : "";
  return {
    scope: taskScopes.includes(scope as TaskScope)
      ? (scope as TaskScope)
      : "week",
    status: selectedStatus,
    project: queryString(query.project),
    ...(query.projects !== undefined
      ? {
          projects:
            (Array.isArray(query.projects)
              ? query.projects
              : [query.projects]
            ).every(
              (value) =>
                typeof value === "string" &&
                value.length > 0 &&
                value.length <= 100,
            ) &&
            (Array.isArray(query.projects) ? query.projects.length : 1) <= 1000
              ? [
                  ...new Set(
                    (Array.isArray(query.projects)
                      ? query.projects
                      : [query.projects]) as string[],
                  ),
                ]
              : [],
        }
      : {}),
    query: queryString(query.q),
    ...(query.assignee !== undefined
      ? { assignee: queryString(query.assignee) || "invalid:assignee" }
      : {}),
    ...(query.risk !== undefined
      ? { risk: queryString(query.risk) || "invalid:risk" }
      : {}),
    // Older links can contain both filters. Explicit status is the specific intent.
    focus: selectedStatus
      ? "all"
      : taskFocuses.includes(focus as TaskFocus)
        ? (focus as TaskFocus)
        : "all",
  };
}
export function selectedTaskState(filters: TaskFilters): TaskState {
  return filters.status || (filters.focus === "done" ? "done" : filters.focus);
}

/** Project route identity wins over any project field carried by a copied URL. */
export function readProjectTaskFilters(
  query: Record<string, unknown>,
  projectId: string,
): TaskFilters {
  return { ...readTaskFilters({ scope: "all", ...query }), project: projectId };
}
export function taskStateFilter(
  state: TaskState,
): Pick<TaskFilters, "status" | "focus"> {
  return {
    status: statuses.includes(state as Status) ? (state as Status) : "",
    focus: state === "open" ? "open" : "all",
  };
}

/** Determine leaves before filtering: an excluded child never turns its parent into work. */
export function filterTaskWork(
  tasks: Task[],
  filters: TaskFilters,
  now = new Date(),
  members: readonly Member[] = [],
  timeZone = "UTC",
  actorId?: string,
): Task[] {
  return createTaskViewIndex(tasks, { now, members, timeZone, actorId }).select(
    filters,
  );
}
