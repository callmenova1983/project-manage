import { dateSchema, type Task } from "../../../../packages/domain/types";

/** Only current-week calendar days are accepted from the overview URL. */
export function validWorkbenchDay(
  value: unknown,
  days: readonly string[],
): string {
  return typeof value === "string" &&
    dateSchema.safeParse(value).success &&
    days.includes(value)
    ? value
    : "";
}

function compareTasks(a: Task, b: Task): number {
  return (
    Number(!a.dueDate) - Number(!b.dueDate) ||
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

/** Input is the shared work-scope selection, already restricted to active leaves. */
export function workbenchTaskGroups(
  tasks: readonly Task[],
  selectedDay?: string,
): { scheduled: Task[]; undated: Task[]; done: Task[] } {
  const groups = {
    scheduled: [] as Task[],
    undated: [] as Task[],
    done: [] as Task[],
  };
  for (const task of tasks) {
    if (selectedDay && !task.workDates.includes(selectedDay)) continue;
    if (task.status === "done") groups.done.push(task);
    else if (task.workDates.length) groups.scheduled.push(task);
    else groups.undated.push(task);
  }
  for (const rows of Object.values(groups)) rows.sort(compareTasks);
  return groups;
}
