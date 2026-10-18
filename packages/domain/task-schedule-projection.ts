import { dateSchema, DomainError, type Task } from "./types.js";
import { validateTaskSchedule } from "./task-schedule.js";
export interface ScheduleProjectionRow {
  task: Task;
  aggregate: boolean;
  start: string | null;
  end: string | null;
  milestone: boolean;
  totalLeaves: number;
  scheduledLeaves: number;
  unscheduledLeaves: number;
  incomplete: boolean;
}
/** Parent intervals use all active descendant leaves, before semantic/window filters. */
export function projectTaskSchedules(
  tasks: readonly Task[],
  matchedIds: ReadonlySet<string>,
  window?: { start: string; end: string },
) {
  if (window) {
    dateSchema.parse(window.start);
    dateSchema.parse(window.end);
    if (window.start > window.end)
      throw new DomainError("Schedule window start cannot follow its end.");
  }
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const parentIds = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  const summaries = new Map<string, ScheduleProjectionRow>();
  for (const task of tasks)
    if (!task.voided)
      summaries.set(task.id, {
        task,
        aggregate: parentIds.has(task.id),
        start: null,
        end: null,
        milestone: false,
        totalLeaves: 0,
        scheduledLeaves: 0,
        unscheduledLeaves: 0,
        incomplete: false,
      });
  const activeLeaves = tasks.filter(
    (task) => !task.voided && !parentIds.has(task.id),
  );
  for (const task of activeLeaves) {
    validateTaskSchedule(task);
    const row = summaries.get(task.id)!;
    row.start = task.scheduleStart ?? null;
    row.end = task.scheduleEnd ?? null;
    row.milestone = !!task.milestone;
    row.totalLeaves = 1;
    row.scheduledLeaves = row.start ? 1 : 0;
    row.unscheduledLeaves = row.start ? 0 : 1;
    row.incomplete = !row.start;
    const seen = new Set([task.id]);
    let parentId = task.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = taskMap.get(parentId),
        aggregate = summaries.get(parentId);
      if (!parent || parent.projectId !== task.projectId || !aggregate) break;
      aggregate.totalLeaves++;
      aggregate.scheduledLeaves += row.scheduledLeaves;
      aggregate.unscheduledLeaves += row.unscheduledLeaves;
      aggregate.incomplete = aggregate.unscheduledLeaves > 0;
      if (row.start && row.end) {
        if (!aggregate.start || row.start < aggregate.start)
          aggregate.start = row.start;
        if (!aggregate.end || row.end > aggregate.end) aggregate.end = row.end;
      }
      parentId = parent.parentId;
    }
  }
  const matchedLeaves = [...summaries.values()]
    .filter((row) => !row.aggregate && matchedIds.has(row.task.id))
    .sort((a, b) => a.task.id.localeCompare(b.task.id));
  const contextIds = new Set<string>();
  for (const row of matchedLeaves) {
    const seen = new Set([row.task.id]);
    let parentId = row.task.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = summaries.get(parentId);
      if (!parent || parent.task.projectId !== row.task.projectId) break;
      contextIds.add(parentId);
      parentId = parent.task.parentId;
    }
  }
  const scheduled = matchedLeaves.filter((row) => row.start && row.end);
  const inWindow = scheduled.filter(
    (row) => !window || (row.start! <= window.end && row.end! >= window.start),
  );
  const visible = new Set(inWindow.map((row) => row.task.id));
  return {
    summaries,
    matchedLeaves,
    scheduled,
    unscheduled: matchedLeaves.filter((row) => !row.start),
    milestones: scheduled.filter((row) => row.milestone),
    inWindow,
    outsideWindow: scheduled.filter((row) => !visible.has(row.task.id)),
    parents: [...contextIds]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => summaries.get(id)!),
    counts: {
      total: matchedLeaves.length,
      scheduled: scheduled.length,
      unscheduled: matchedLeaves.length - scheduled.length,
      inWindow: inWindow.length,
    },
  };
}
