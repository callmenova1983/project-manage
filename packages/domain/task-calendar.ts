import { Temporal } from "@js-temporal/polyfill";
import { calendarWeek, zonedDay } from "./time-zone.js";
import { dateSchema, taskInput, type Task } from "./types.js";
import type { TaskInput } from "./types.js";
import { moveTaskWorkWeek } from "./task-planning.js";

export const calendarBases = ["due", "work", "estimated", "reminder"] as const;
export type CalendarBasis = (typeof calendarBases)[number];
export type CalendarLayout = "month" | "week" | "agenda";
export type TaskDatePrefill = Pick<
  TaskInput,
  "dueDate" | "workWeek" | "workDates" | "estimatedDate" | "reminderAt"
>;
export function calendarTaskDateInput(
  task: Task,
  basis: CalendarBasis,
  values: {
    date: string | null;
    workWeek: string | null;
    workDates: string[];
    reminderAt: string | null;
  },
): TaskInput {
  if (basis === "work") moveTaskWorkWeek(values, values.workWeek);
  const patch =
    basis === "work"
      ? { workWeek: values.workWeek, workDates: values.workDates }
      : basis === "reminder"
        ? { reminderAt: values.reminderAt }
        : basis === "estimated"
          ? { estimatedDate: values.date }
          : { dueDate: values.date };
  return taskInput.parse({ ...taskInput.strip().parse(task), ...patch });
}
export function calendarTaskPrefill(
  basis: CalendarBasis,
  date: string,
  reminderAt?: string,
): TaskDatePrefill {
  dateSchema.parse(date);
  const empty: TaskDatePrefill = {
    dueDate: null,
    workWeek: null,
    workDates: [],
    estimatedDate: null,
    reminderAt: null,
  };
  if (basis === "work")
    return { ...empty, workWeek: calendarWeek(date), workDates: [date] };
  if (basis === "due") return { ...empty, dueDate: date };
  if (basis === "estimated") return { ...empty, estimatedDate: date };
  if (!reminderAt)
    throw new Error("Choose a reminder time before creating a task.");
  Temporal.Instant.from(reminderAt);
  return { ...empty, reminderAt };
}
export interface TaskCalendarEvent {
  id: string;
  taskId: string;
  date: string;
  basis: CalendarBasis;
  instant?: string;
}
export function calendarWindow(anchor: string, layout: CalendarLayout) {
  const date = Temporal.PlainDate.from(dateSchema.parse(anchor));
  const first = layout === "month" ? date.with({ day: 1 }) : date;
  const start =
    layout === "agenda"
      ? first
      : Temporal.PlainDate.from(calendarWeek(first.toString()));
  const length = layout === "month" ? 42 : layout === "week" ? 7 : 30;
  return {
    anchor: date.toString(),
    start: start.toString(),
    end: start.add({ days: length }).toString(),
    days: Array.from({ length }, (_, index) =>
      start.add({ days: index }).toString(),
    ),
  };
}
export function shiftCalendarAnchor(
  anchor: string,
  layout: CalendarLayout,
  direction: -1 | 1,
) {
  const date = Temporal.PlainDate.from(dateSchema.parse(anchor));
  return date
    .add(
      layout === "month"
        ? { months: direction }
        : { days: direction * (layout === "week" ? 7 : 30) },
    )
    .toString();
}

/** Input is already the shared semantic task selection; events never duplicate tasks. */
export function projectTaskCalendar(
  tasks: readonly Task[],
  basis: CalendarBasis,
  window: { start: string; end: string },
  timeZone = "UTC",
) {
  const events: TaskCalendarEvent[] = [];
  const missing: Task[] = [];
  const undatedWeeks = new Map<string, Task[]>();
  const outsideTaskIds = new Set<string>();
  const visibleTaskIds = new Set<string>();
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.voided || seen.has(task.id)) continue;
    seen.add(task.id);
    let dates: string[] = [];
    if (basis === "work") {
      dates = [...new Set(task.workDates)];
      if (!dates.length && task.workWeek) {
        const group = undatedWeeks.get(task.workWeek) ?? [];
        group.push(task);
        undatedWeeks.set(task.workWeek, group);
        continue;
      }
    } else if (basis === "reminder") {
      if (task.reminderAt)
        dates = [zonedDay(new Date(task.reminderAt), timeZone)];
    } else {
      const date = basis === "due" ? task.dueDate : task.estimatedDate;
      if (date) dates = [date];
    }
    if (!dates.length) missing.push(task);
    for (const date of dates) {
      if (date < window.start || date >= window.end) {
        outsideTaskIds.add(task.id);
        continue;
      }
      visibleTaskIds.add(task.id);
      events.push({
        id: `${task.id}:${basis}:${date}`,
        taskId: task.id,
        date,
        basis,
        ...(basis === "reminder" && task.reminderAt
          ? { instant: task.reminderAt }
          : {}),
      });
    }
  }
  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.instant ?? "").localeCompare(b.instant ?? "") ||
      a.taskId.localeCompare(b.taskId),
  );
  const outsideOnly = [...outsideTaskIds].filter(
    (id) => !visibleTaskIds.has(id),
  );
  return {
    events,
    missing,
    visibleTaskCount: visibleTaskIds.size,
    outsideTaskCount: outsideOnly.length,
    outsideTaskIds: outsideOnly,
    undatedWeeks: [...undatedWeeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, tasks]) => ({
        week,
        tasks,
        inWindow:
          week < window.end &&
          Temporal.PlainDate.from(week).add({ days: 7 }).toString() >
            window.start,
      })),
  };
}
