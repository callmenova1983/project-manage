import { zonedDay, zonedWeek } from "./time-zone.js";
import { leafTasks, type Project, type Task } from "./types.js";
export function stageSummaries(
  projects: Project[],
  tasks: Task[],
  now = new Date(),
  timeZone = "UTC",
) {
  const stages = new Map(projects.map((p) => [p.id, p.stage]));
  const result: Record<
    string,
    {
      projects: number;
      open: number;
      planned: number;
      blocked: number;
      overdue: number;
      unplanned: number;
    }
  > = {};
  for (const project of projects) {
    const counts = (result[project.stage] ??= {
      projects: 0,
      open: 0,
      planned: 0,
      blocked: 0,
      overdue: 0,
      unplanned: 0,
    });
    counts.projects++;
  }
  const week = zonedWeek(now, timeZone),
    today = zonedDay(now, timeZone);
  for (const task of leafTasks(tasks)) {
    const stage = stages.get(task.projectId),
      counts = stage ? result[stage] : undefined;
    if (!counts) continue;
    if (task.workWeek === week) counts.planned++;
    if (task.status === "done") continue;
    counts.open++;
    if (task.status === "blocked") counts.blocked++;
    if (task.dueDate && task.dueDate < today) counts.overdue++;
    if (!task.workWeek && !task.workDates.length) counts.unplanned++;
  }
  return result;
}
