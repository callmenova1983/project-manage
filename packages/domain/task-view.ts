import { hasTaskAssignee } from "./task-field-copy.js";
import {
  dayKey,
  weekKey,
  type Member,
  type Status,
  type Task,
} from "./types.js";

export interface TaskViewQuery {
  scope: "today" | "week" | "all";
  status: Status | "";
  project: string;
  projects?: readonly string[];
  query: string;
  focus: "all" | "open" | "done";
  assignee?: string;
  risk?: string;
}

export interface TaskViewContext {
  now?: Date;
  timeZone?: string;
  members?: readonly Member[];
  actorId?: string;
}

export function taskAssigneeKey(task: Task): string {
  if (!hasTaskAssignee(task)) return "none";
  if (task.assigneeId) return `member:${task.assigneeId}`;
  const name = task.assignee.trim();
  return name ? `text:${name}` : "none";
}

export function taskIsOverdue(task: Task, today: string): boolean {
  return task.status !== "done" && !!task.dueDate && task.dueDate < today;
}

export function taskIsUnplanned(task: Task): boolean {
  return task.status !== "done" && !task.workWeek && !task.workDates.length;
}

/** Index the full graph once. Filtering never promotes a parent to leaf work. */
export function createTaskViewIndex(
  tasks: readonly Task[],
  context: TaskViewContext = {},
) {
  const now = context.now ?? new Date();
  const timeZone = context.timeZone ?? "UTC";
  const today = dayKey(now, timeZone);
  const week = weekKey(now, timeZone);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parentIds = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  const members = new Map(
    (context.members ?? []).map((member) => [member.id, member]),
  );
  const leaves = tasks.filter(
    (task) => !task.voided && !parentIds.has(task.id),
  );
  const searchText = new Map(
    tasks.map((task) => {
      const name =
        (task.assigneeId && members.get(task.assigneeId)?.name) ||
        task.assignee ||
        "Unassigned";
      return [
        task.id,
        `${task.title} ${name} ${task.voided?.reason ?? ""}`.toLocaleLowerCase(),
      ];
    }),
  );

  function selectFrom(rows: readonly Task[], query: TaskViewQuery): Task[] {
    const projectIds =
      query.projects === undefined ? null : new Set(query.projects);
    const text = query.query.trim().toLocaleLowerCase();
    const assignee =
      query.assignee === "me"
        ? context.actorId
          ? `member:${context.actorId}`
          : "invalid:missing-actor"
        : query.assignee;
    return rows.filter(
      (task) =>
        (query.scope === "all" ||
          (query.scope === "today"
            ? task.workDates.includes(today)
            : task.workWeek === week)) &&
        (!query.status || task.status === query.status) &&
        (!query.project || task.projectId === query.project) &&
        (!projectIds || projectIds.has(task.projectId)) &&
        (query.focus === "all" ||
          (query.focus === "done"
            ? task.status === "done"
            : task.status !== "done")) &&
        (!assignee || taskAssigneeKey(task) === assignee) &&
        (!query.risk ||
          (query.risk === "overdue"
            ? taskIsOverdue(task, today)
            : query.risk === "unplanned"
              ? taskIsUnplanned(task)
              : query.risk === "blocked"
                ? task.status === "blocked"
                : false)) &&
        (!text || searchText.get(task.id)!.includes(text)),
    );
  }

  function select(query: TaskViewQuery): Task[] {
    return selectFrom(leaves, query);
  }

  /** Include voided parents so users can restore a complete cancelled branch. */
  function selectVoided(query: TaskViewQuery): Task[] {
    return selectFrom(
      tasks.filter((task) => !!task.voided),
      query,
    );
  }

  function project(query: TaskViewQuery) {
    const matchedLeafTasks = select(query);
    const contextIds = new Set<string>();
    const counts = {
      total: matchedLeafTasks.length,
      open: 0,
      todo: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      overdue: 0,
      unplanned: 0,
      unassigned: 0,
    };
    const overdue: Task[] = [],
      unplanned: Task[] = [],
      unassigned: Task[] = [];
    for (const task of matchedLeafTasks) {
      counts[task.status]++;
      if (task.status !== "done") counts.open++;
      if (taskIsOverdue(task, today)) overdue.push(task);
      if (taskIsUnplanned(task)) unplanned.push(task);
      if (taskAssigneeKey(task) === "none") unassigned.push(task);
      const visited = new Set([task.id]);
      let parentId = task.parentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent || parent.projectId !== task.projectId) break;
        if (!parent.voided) contextIds.add(parent.id);
        parentId = parent.parentId;
      }
    }
    counts.overdue = overdue.length;
    counts.unplanned = unplanned.length;
    counts.unassigned = unassigned.length;
    return {
      matchedLeafTasks,
      contextParents: tasks.filter((task) => contextIds.has(task.id)),
      counts,
      risks: { overdue, unplanned, unassigned },
      today,
      week,
    };
  }

  return { select, selectVoided, project, today, week };
}
