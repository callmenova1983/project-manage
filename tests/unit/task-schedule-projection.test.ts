import { describe, expect, it } from "vitest";
import { projectTaskSchedules } from "../../packages/domain/task-schedule-projection";
import { createSeed } from "../../packages/domain/seed";
import type { Task } from "../../packages/domain/types";
function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    ...createSeed().tasks[0]!,
    id,
    parentId: null,
    workWeek: null,
    workDates: [],
    scheduleStart: null,
    scheduleEnd: null,
    ...patch,
  };
}
describe("schedule projection before filtering", () => {
  it("keeps full descendant intervals when only one child matches and marks incomplete plans", () => {
    const tasks = [
      task("root"),
      task("parent", { parentId: "root" }),
      task("early", {
        parentId: "parent",
        scheduleStart: "2026-12-28",
        scheduleEnd: "2027-01-02",
      }),
      task("late", {
        parentId: "parent",
        scheduleStart: "2027-01-10",
        scheduleEnd: "2027-01-20",
      }),
      task("missing", { parentId: "parent" }),
    ];
    const before = JSON.stringify(tasks);
    const result = projectTaskSchedules(tasks, new Set(["late"]), {
      start: "2027-01-15",
      end: "2027-01-15",
    });
    expect(result.counts).toEqual({
      total: 1,
      scheduled: 1,
      unscheduled: 0,
      inWindow: 1,
    });
    expect(result.parents.map((row) => row.task.id)).toEqual([
      "parent",
      "root",
    ]);
    expect(result.parents[0]).toMatchObject({
      aggregate: true,
      start: "2026-12-28",
      end: "2027-01-20",
      totalLeaves: 3,
      scheduledLeaves: 2,
      unscheduledLeaves: 1,
      incomplete: true,
    });
    expect(result.summaries.get("root")).toMatchObject({
      start: "2026-12-28",
      end: "2027-01-20",
    });
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("does not turn a parent with only voided children into scheduled leaf work", () => {
    const tasks = [
      task("parent"),
      task("voided", {
        parentId: "parent",
        scheduleStart: "2026-10-16",
        scheduleEnd: "2026-10-17",
        voided: {
          at: "2026-10-16T00:00:00Z",
          actor: "Synthetic",
          actorId: "synthetic",
          reason: "cancelled",
          batchId: "batch",
        },
      }),
      task("unplanned"),
    ];
    const result = projectTaskSchedules(
      tasks,
      new Set(tasks.map((task) => task.id)),
    );
    expect(result.matchedLeaves.map((row) => row.task.id)).toEqual([
      "unplanned",
    ]);
    expect(result.summaries.get("parent")).toMatchObject({
      aggregate: true,
      start: null,
      end: null,
      totalLeaves: 0,
    });
    expect(result.unscheduled.map((row) => row.task.id)).toEqual(["unplanned"]);
  });
  it("uses inclusive window overlap, keeps milestones and does not invent a parent interval", () => {
    const tasks = [
      task("root"),
      task("missing", { parentId: "root" }),
      task("milestone", {
        scheduleStart: "2026-10-16",
        scheduleEnd: "2026-10-16",
        milestone: true,
      }),
      task("later", { scheduleStart: "2026-10-17", scheduleEnd: "2026-10-18" }),
    ];
    const result = projectTaskSchedules(
      tasks,
      new Set(["missing", "milestone", "later"]),
      { start: "2026-10-16", end: "2026-10-16" },
    );
    expect(result.inWindow.map((row) => row.task.id)).toEqual(["milestone"]);
    expect(result.outsideWindow.map((row) => row.task.id)).toEqual(["later"]);
    expect(result.milestones.map((row) => row.task.id)).toEqual(["milestone"]);
    expect(result.parents[0]).toMatchObject({
      start: null,
      end: null,
      incomplete: true,
    });
    expect(() =>
      projectTaskSchedules(tasks, new Set(), {
        start: "2026-10-17",
        end: "2026-10-16",
      }),
    ).toThrow();
  });
  it("aggregates twenty levels deterministically and excludes cross-project ancestry", () => {
    const tasks = Array.from({ length: 20 }, (_, index) =>
      task(String(index), {
        parentId: index ? String(index - 1) : null,
        ...(index === 19
          ? { scheduleStart: "2026-10-16", scheduleEnd: "2026-10-20" }
          : {}),
      }),
    );
    const result = projectTaskSchedules(tasks, new Set(["19"]));
    expect(result.parents).toHaveLength(19);
    expect(
      result.parents.every(
        (row) => row.totalLeaves === 1 && row.start === "2026-10-16",
      ),
    ).toBe(true);
    expect(
      projectTaskSchedules([...tasks].reverse(), new Set(["19"])).parents.map(
        (row) => [row.task.id, row.start, row.end],
      ),
    ).toEqual(result.parents.map((row) => [row.task.id, row.start, row.end]));
    const foreign = [
      task("foreign", { projectId: "another" }),
      task("leaf", {
        parentId: "foreign",
        scheduleStart: "2026-10-16",
        scheduleEnd: "2026-10-17",
      }),
    ];
    expect(projectTaskSchedules(foreign, new Set(["leaf"])).parents).toEqual(
      [],
    );
  });
});
