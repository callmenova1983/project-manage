import { Temporal } from "@js-temporal/polyfill";
import { zonedDay } from "./time-zone.js";
import { leafTasks, type Task } from "./types.js";
import { taskDependencyWarnings } from "./task-dependencies.js";

/** Actionable planning facts use schedule dates, independently of due/work dates. */
export function scheduleOverview(
  tasks: readonly Task[],
  projectIds: ReadonlySet<string>,
  now = new Date(),
  timeZone = "UTC",
) {
  const today = zonedDay(now, timeZone);
  const end = Temporal.PlainDate.from(today).add({ days: 29 }).toString();
  const milestones = leafTasks([...tasks]).filter(
    (task) =>
      projectIds.has(task.projectId) &&
      task.milestone &&
      task.scheduleStart &&
      task.status !== "done",
  );
  const sort = (a: Task, b: Task) =>
    a.scheduleStart!.localeCompare(b.scheduleStart!) ||
    a.id.localeCompare(b.id);
  const upcoming = milestones
    .filter(
      (task) => task.scheduleStart! >= today && task.scheduleStart! <= end,
    )
    .sort(sort);
  const overdue = milestones
    .filter((task) => task.scheduleStart! < today)
    .sort(sort);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const warnings = taskDependencyWarnings(tasks)
    .filter((warning) => {
      const task = byId.get(warning.taskId)!;
      return projectIds.has(task.projectId) && task.status !== "done";
    })
    .map((warning) => ({
      ...warning,
      task: byId.get(warning.taskId)!,
      predecessor: byId.get(warning.predecessorId)!,
    }));
  return { today, end, upcoming, overdue, warnings };
}
