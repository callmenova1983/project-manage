import { Temporal } from "@js-temporal/polyfill";
import { dateSchema, DomainError, type Task } from "./types.js";
import { validateTaskSchedule } from "./task-schedule.js";
import {
  projectTaskSchedules,
  type ScheduleProjectionRow,
} from "./task-schedule-projection.js";

export type GanttScale = "day" | "week" | "month";
export type GanttGesture = "move" | "start" | "end";
/** Pure date proposal: no graph mutation and no automatic successor rescheduling. */
export function adjustGanttSchedule(
  task: Task,
  mode: GanttGesture,
  deltaDays: number,
) {
  if (!Number.isSafeInteger(deltaDays) || Math.abs(deltaDays) > 36600)
    throw new DomainError("Choose a valid schedule adjustment.");
  if (!task.scheduleStart || !task.scheduleEnd || task.voided)
    throw new DomainError("Only active scheduled leaf tasks can be adjusted.");
  if (task.milestone && mode !== "move")
    throw new DomainError("Move a milestone as a single date.");
  const start = Temporal.PlainDate.from(task.scheduleStart);
  const end = Temporal.PlainDate.from(task.scheduleEnd);
  const patch = {
    scheduleStart:
      mode === "end"
        ? start.toString()
        : start.add({ days: deltaDays }).toString(),
    scheduleEnd:
      mode === "start"
        ? end.toString()
        : end.add({ days: deltaDays }).toString(),
    milestone: !!task.milestone,
  };
  validateTaskSchedule(patch);
  return patch;
}
export function ganttWindow(anchor: string, scale: GanttScale) {
  dateSchema.parse(anchor);
  let start = Temporal.PlainDate.from(anchor);
  if (scale === "week") start = start.subtract({ days: start.dayOfWeek - 1 });
  if (scale === "month") start = start.with({ day: 1 });
  const exclusive = start.add(
    scale === "month" ? { months: 6 } : { days: scale === "week" ? 84 : 42 },
  );
  const dayWidth = scale === "day" ? 28 : scale === "week" ? 12 : 6;
  const days = start.until(exclusive).days;
  const ticks: { date: string; offset: number; width: number }[] = [];
  let cursor = start;
  while (Temporal.PlainDate.compare(cursor, exclusive) < 0) {
    const next = cursor.add(
      scale === "month" ? { months: 1 } : { days: scale === "week" ? 7 : 1 },
    );
    ticks.push({
      date: cursor.toString(),
      offset: start.until(cursor).days * dayWidth,
      width:
        Math.min(
          cursor.until(next).days,
          start.until(exclusive).days - start.until(cursor).days,
        ) * dayWidth,
    });
    cursor = next;
  }
  return {
    start: start.toString(),
    end: exclusive.subtract({ days: 1 }).toString(),
    days,
    dayWidth,
    width: days * dayWidth,
    ticks,
  };
}
export function ganttBar(
  start: string | null,
  end: string | null,
  window: ReturnType<typeof ganttWindow>,
) {
  if (!start || !end || start > window.end || end < window.start) return null;
  const left = start < window.start ? window.start : start;
  const right = end > window.end ? window.end : end;
  return {
    offset:
      Temporal.PlainDate.from(window.start).until(Temporal.PlainDate.from(left))
        .days * window.dayWidth,
    width:
      (Temporal.PlainDate.from(left).until(Temporal.PlainDate.from(right))
        .days +
        1) *
      window.dayWidth,
    clippedStart: start < window.start,
    clippedEnd: end > window.end,
  };
}
export interface GanttRow extends ScheduleProjectionRow {
  depth: number;
}
/** Collapse already-projected preorder rows without recalculating task dates. */
export function visibleGanttRows(
  rows: readonly GanttRow[],
  collapsed: ReadonlySet<string>,
) {
  const visible: GanttRow[] = [];
  let hiddenDepth: number | null = null;
  for (const row of rows) {
    if (hiddenDepth !== null && row.depth > hiddenDepth) continue;
    hiddenDepth = null;
    visible.push(row);
    if (row.aggregate && collapsed.has(row.task.id)) hiddenDepth = row.depth;
  }
  return visible;
}
/** Traverse only matching leaves and their context; aggregate dates still use the full graph. */
export function taskGanttRows(
  tasks: readonly Task[],
  matchedIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string> = new Set(),
) {
  const projection = projectTaskSchedules(tasks, matchedIds);
  const included = new Map(
    [...projection.parents, ...projection.matchedLeaves].map((row) => [
      row.task.id,
      row,
    ]),
  );
  const children = new Map<string, GanttRow[]>();
  const roots: GanttRow[] = [];
  for (const task of tasks) {
    const row = included.get(task.id);
    if (!row) continue;
    const item = { ...row, depth: 0 };
    const parent = task.parentId && included.get(task.parentId);
    if (parent && parent.task.projectId === task.projectId) {
      const siblings = children.get(parent.task.id) ?? [];
      siblings.push(item);
      children.set(parent.task.id, siblings);
    } else roots.push(item);
  }
  const rows: GanttRow[] = [];
  const projectRoots = new Map<string, GanttRow[]>();
  for (const row of roots) {
    const group = projectRoots.get(row.task.projectId) ?? [];
    group.push(row);
    projectRoots.set(row.task.projectId, group);
  }
  for (const group of projectRoots.values()) {
    const stack = [...group].reverse();
    while (stack.length) {
      const row = stack.pop()!;
      rows.push(row);
      if (!collapsed.has(row.task.id))
        for (const child of [...(children.get(row.task.id) ?? [])].reverse())
          stack.push({ ...child, depth: row.depth + 1 });
    }
  }
  return { rows, projection };
}
