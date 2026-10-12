import { it, expect } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  plannedWork,
  retainedWorkSelection,
} from "../../apps/web/src/composables/planned-work";
const now = new Date("2026-10-12T12:00:00Z");
it("uses planned dates for ordering and due dates only as supplementary information", () => {
  const seed = createSeed();
  const project = seed.projects[0]!;
  const task = seed.tasks.find((task) => !task.parentId)!;
  const rows = [
    {
      ...task,
      id: "late",
      title: "Later plan",
      projectId: project.id,
      status: "todo" as const,
      workWeek: "2026-10-12",
      workDates: ["2026-10-15"],
      dueDate: "2026-10-11",
    },
    {
      ...task,
      id: "today",
      title: "Today's work",
      projectId: project.id,
      status: "todo" as const,
      workWeek: "2026-10-12",
      workDates: ["2026-10-12"],
      dueDate: null,
    },
    {
      ...task,
      id: "unassigned",
      title: "No day",
      projectId: project.id,
      status: "todo" as const,
      workWeek: "2026-10-12",
      workDates: [],
      dueDate: "2026-10-12",
    },
  ];
  expect(
    plannedWork(rows, [project], "week", now).map(({ task }) => task.id),
  ).toEqual(["today", "late", "unassigned"]);
  expect(
    plannedWork(rows, [project], "today", now).map(({ task }) => task.id),
  ).toEqual(["today"]);
});
it("excludes parents, done tasks and projects outside the current set", () => {
  const seed = createSeed(now);
  const project = seed.projects[0]!;
  const selected = plannedWork(seed.tasks, [project], "week", now);
  for (const { task } of selected) {
    expect(task.projectId).toBe(project.id);
    expect(task.status).not.toBe("done");
    expect(seed.tasks.some((child) => child.parentId === task.id)).toBe(false);
  }
  expect(plannedWork(seed.tasks, [], "week", now)).toEqual([]);
});
it("keeps a selected task through reordering and selects its surviving neighbour on removal", () => {
  expect(retainedWorkSelection(["a", "b", "c"], ["c", "b", "a"], "b")).toBe(
    "b",
  );
  expect(retainedWorkSelection(["a", "b", "c"], ["a", "c"], "b")).toBe("c");
  expect(retainedWorkSelection(["a", "b"], ["a"], "b")).toBe("a");
  expect(retainedWorkSelection(["a"], [], "a")).toBe("");
});
