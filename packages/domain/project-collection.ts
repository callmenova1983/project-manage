import { createTaskViewIndex, taskIsOverdue } from "./task-view.js";
import type { Project, Task } from "./types.js";
export function projectCollectionProjection(
  projects: readonly Project[],
  tasks: readonly Task[],
  stages: readonly { id: string; order: number; archived?: boolean }[],
  context: { now?: Date; timeZone?: string; scope?: "today" | "week" } = {},
) {
  const index = createTaskViewIndex(tasks, context);
  const rows = projects.filter((project) => !project.intakeInbox);
  const stats = new Map(
    rows.map((project) => [
      project.id,
      { total: 0, open: 0, done: 0, blocked: 0, overdue: 0, planned: 0 },
    ]),
  );
  for (const task of index.select({
    scope: "all",
    project: "",
    status: "",
    focus: "all",
    query: "",
  })) {
    const counts = stats.get(task.projectId);
    if (!counts) continue;
    counts.total++;
    if (task.status === "done") counts.done++;
    else counts.open++;
    if (task.status === "blocked") counts.blocked++;
    if (taskIsOverdue(task, index.today)) counts.overdue++;
    if (
      context.scope === "today"
        ? task.workDates.includes(index.today)
        : task.workWeek === index.week
    )
      counts.planned++;
  }
  const catalog = [...stages].sort((a, b) => a.order - b.order);
  const ids = [
    ...new Set([
      ...catalog
        .filter(
          (stage) =>
            !stage.archived ||
            rows.some((project) => project.stage === stage.id),
        )
        .map((stage) => stage.id),
      "unclassified",
      ...rows.map((project) => project.stage),
    ]),
  ];
  return {
    stats,
    inbox: projects.filter((project) => project.intakeInbox),
    columns: ids.map((id) => ({
      id,
      archived: !!catalog.find((stage) => stage.id === id)?.archived,
      unknown:
        id !== "unclassified" && !catalog.some((stage) => stage.id === id),
      projects: rows.filter((project) => project.stage === id),
    })),
  };
}
