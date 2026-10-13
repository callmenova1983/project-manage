import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { stageSummaries } from "../../packages/domain/stage-summary";
import type { Task } from "../../packages/domain/types";

it("counts actual scheduled work and risks without counting parents or treating unknown dates as overdue", () => {
  const seed = createSeed(),
    base = seed.tasks[0]!;
  const projects = [
    { ...seed.projects[0]!, id: "school", stage: "proposal" },
    { ...seed.projects[1]!, id: "hotel", stage: "implementation" },
  ];
  const task = (id: string, data: Partial<Task>): Task => ({
    ...base,
    id,
    projectId: "school",
    parentId: null,
    status: "todo",
    workWeek: null,
    workDates: [],
    dueDate: null,
    ...data,
  });
  const tasks = [
    task("parent", { dueDate: "2026-10-01" }),
    task("child", {
      parentId: "parent",
      workWeek: "2026-10-12",
      dueDate: "2026-10-12",
    }),
    task("done", {
      parentId: "parent",
      status: "done",
      workWeek: "2026-10-12",
      dueDate: "2026-10-01",
    }),
    task("blocked", { projectId: "hotel", status: "blocked" }),
    task("future", {
      projectId: "hotel",
      workWeek: "2026-10-19",
      dueDate: "2026-10-20",
    }),
    task("outside", {
      projectId: "excluded",
      status: "blocked",
      dueDate: "2026-10-01",
    }),
  ];
  expect(
    stageSummaries(projects, tasks, new Date("2026-10-13T10:00:00Z")),
  ).toEqual({
    proposal: {
      projects: 1,
      open: 1,
      planned: 2,
      blocked: 0,
      overdue: 1,
      unplanned: 0,
    },
    implementation: {
      projects: 1,
      open: 2,
      planned: 0,
      blocked: 1,
      overdue: 0,
      unplanned: 1,
    },
  });
});
