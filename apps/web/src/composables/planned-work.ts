import {
  dayKey,
  weekKey,
  leafTasks,
  type Task,
  type Project,
} from "../../../../packages/domain/types";
export function plannedWork(
  tasks: Task[],
  projects: Project[],
  scope: "today" | "week",
  now = new Date(),
  timeZone = "UTC",
) {
  const ids = new Set(projects.map((project) => project.id));
  const today = dayKey(now, timeZone),
    week = weekKey(now, timeZone);
  return leafTasks(tasks)
    .filter(
      (task) =>
        ids.has(task.projectId) &&
        task.status !== "done" &&
        (scope === "today"
          ? task.workDates.includes(today)
          : task.workWeek === week),
    )
    .map((task) => ({
      task,
      date: task.workDates.includes(today)
        ? today
        : ([...task.workDates].sort().find((day) => day >= today) ??
          [...task.workDates].sort().at(-1) ??
          null),
    }))
    .sort(
      (a, b) =>
        Number(b.date === today) - Number(a.date === today) ||
        (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
        a.task.title.localeCompare(b.task.title),
    );
}
/** Retain the same item, or its nearest surviving neighbour after completion. */
export function retainedWorkSelection(
  oldIds: string[],
  newIds: string[],
  selected: string,
) {
  if (newIds.includes(selected)) return selected;
  return (
    newIds[
      Math.min(Math.max(oldIds.indexOf(selected), 0), newIds.length - 1)
    ] ?? ""
  );
}
