import { expect, it } from "vitest";
import {
  ganttWindow,
  ganttBar,
  taskGanttRows,
  adjustGanttSchedule,
  visibleGanttRows,
} from "../../packages/domain/task-gantt";
import { createSeed } from "../../packages/domain/seed";
it("moves across month and DST boundaries without changing duration or business fields", () => {
  const task = {
    ...createSeed().tasks[0]!,
    scheduleStart: "2028-02-28",
    scheduleEnd: "2028-03-02",
    milestone: false,
  };
  const before = JSON.stringify(task);
  expect(adjustGanttSchedule(task, "move", 2)).toEqual({
    scheduleStart: "2028-03-01",
    scheduleEnd: "2028-03-04",
    milestone: false,
  });
  expect(adjustGanttSchedule(task, "start", 1)).toMatchObject({
    scheduleStart: "2028-02-29",
    scheduleEnd: "2028-03-02",
  });
  expect(adjustGanttSchedule(task, "end", -1)).toMatchObject({
    scheduleStart: "2028-02-28",
    scheduleEnd: "2028-03-01",
  });
  expect(() => adjustGanttSchedule(task, "start", 10)).toThrow(/cannot follow/);
  expect(() => adjustGanttSchedule(task, "move", 0.5)).toThrow();
  const milestone = {
    ...task,
    scheduleEnd: task.scheduleStart,
    milestone: true,
  };
  expect(adjustGanttSchedule(milestone, "move", 2)).toMatchObject({
    scheduleStart: "2028-03-01",
    scheduleEnd: "2028-03-01",
    milestone: true,
  });
  expect(() => adjustGanttSchedule(milestone, "end", 1)).toThrow(/single date/);
  expect(JSON.stringify(task)).toBe(before);
});
it("uses closed natural-day intervals and real month lengths", () => {
  const month = ganttWindow("2028-02-29", "month");
  expect(month.start).toBe("2028-02-01");
  expect(month.ticks[0]!.width).toBe(29 * 6);
  expect(month.end).toBe("2028-07-31");
  const window = ganttWindow("2027-03-13", "day");
  expect(ganttBar("2027-03-13", "2027-03-14", window)).toMatchObject({
    offset: 0,
    width: 56,
  });
  expect(ganttBar(null, null, window)).toBeNull();
  expect(ganttBar("2026-01-01", "2026-01-03", window)).toBeNull();
  expect(ganttBar("2027-03-12", "2027-03-13", window)).toMatchObject({
    offset: 0,
    width: 28,
    clippedStart: true,
  });
});
it("retains full parent intervals, selected leaf identity and collapse without changing input", () => {
  const seed = createSeed();
  const parent = seed.tasks.find((task) =>
    seed.tasks.some((child) => child.parentId === task.id),
  )!;
  const leaves = seed.tasks.filter((task) => task.parentId === parent.id);
  Object.assign(leaves[0]!, {
    scheduleStart: "2027-01-10",
    scheduleEnd: "2027-01-11",
  });
  Object.assign(leaves[1]!, {
    scheduleStart: "2027-02-01",
    scheduleEnd: "2027-02-02",
  });
  const before = JSON.stringify(seed.tasks);
  const matched = new Set([leaves[0]!.id]);
  const expanded = taskGanttRows(seed.tasks, matched);
  expect(expanded.rows.map((row) => row.task.id)).toEqual([
    parent.id,
    leaves[0]!.id,
  ]);
  expect(expanded.rows[0]).toMatchObject({
    start: "2027-01-10",
    end: "2027-02-02",
    aggregate: true,
  });
  const collapsed = taskGanttRows(seed.tasks, matched, new Set([parent.id]));
  expect(collapsed.rows.map((row) => row.task.id)).toEqual([parent.id]);
  expect(visibleGanttRows(expanded.rows, new Set([parent.id]))).toEqual(
    collapsed.rows,
  );
  expect(visibleGanttRows(expanded.rows, new Set())).toEqual(expanded.rows);
  expect(collapsed.projection.matchedLeaves.map((row) => row.task.id)).toEqual([
    leaves[0]!.id,
  ]);
  expect(JSON.stringify(seed.tasks)).toBe(before);
  const other = seed.tasks.find(
    (task) =>
      task.projectId !== parent.projectId &&
      !seed.tasks.some((child) => child.parentId === task.id),
  )!;
  const acrossProjects = taskGanttRows(
    seed.tasks,
    new Set([leaves[0]!.id, other.id]),
  );
  expect(
    visibleGanttRows(acrossProjects.rows, new Set([parent.id]))
      .filter((row) => !row.aggregate)
      .map((row) => row.task.id),
  ).toEqual([other.id]);
});
