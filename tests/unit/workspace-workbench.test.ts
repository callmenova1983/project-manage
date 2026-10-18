import { describe, expect, it } from "vitest";
import {
  validWorkbenchDay,
  workbenchTaskGroups,
} from "../../apps/web/src/services/workspace-workbench";
import { projectWorkspaceOverview } from "../../packages/domain/project-view";
import { calendarWindow } from "../../packages/domain/task-calendar";
import type { Task } from "../../packages/domain/types";
import { multiViewContext, multiViewFixture } from "../fixtures/multi-view";

const ids = (tasks: readonly Task[]) => tasks.map((task) => task.id);

describe("workspace workbench groups", () => {
  it("partitions current work into dated, undated and completed leaves without duplicates", () => {
    const snapshot = multiViewFixture();
    const overview = projectWorkspaceOverview(snapshot, snapshot.projects, {
      ...multiViewContext,
      scope: "week",
    });
    const before = structuredClone(overview.tasks);
    const groups = workbenchTaskGroups(overview.tasks);
    expect(ids(groups.scheduled)).toEqual(["a"]);
    expect(ids(groups.undated)).toEqual(["b"]);
    expect(ids(groups.done)).toEqual(["c"]);
    const all = Object.values(groups).flat();
    expect(new Set(ids(all)).size).toBe(overview.tasks.length);
    expect(all).toHaveLength(overview.tasks.length);
    expect(overview.tasks).toEqual(before);
  });

  it("filters a multi-day task once using work dates and keeps completed tasks separate", () => {
    const snapshot = multiViewFixture();
    const overview = projectWorkspaceOverview(snapshot, snapshot.projects, {
      ...multiViewContext,
      scope: "week",
    });
    const monday = workbenchTaskGroups(overview.tasks, "2026-10-19");
    expect(ids(monday.scheduled)).toEqual(["a"]);
    expect(ids(monday.done)).toEqual(["c"]);
    expect(monday.undated).toEqual([]);
    const wednesday = workbenchTaskGroups(overview.tasks, "2026-10-21");
    expect(ids(wednesday.scheduled)).toEqual(["a"]);
    expect(wednesday.done).toEqual([]);
    expect(wednesday.undated).toEqual([]);
  });

  it("preserves the shared scope contract without treating deadlines or schedules as work dates", () => {
    const snapshot = multiViewFixture();
    const result = (scope: "today" | "week" | "all") =>
      workbenchTaskGroups(
        projectWorkspaceOverview(snapshot, snapshot.projects, {
          ...multiViewContext,
          scope,
        }).tasks,
      );
    expect(ids(result("today").scheduled)).toEqual(["a"]);
    expect(result("today").undated).toEqual([]);
    expect(ids(result("week").undated)).toEqual(["b"]);
    // d has a deadline today and a Gantt interval, but no work arrangement.
    expect(ids(result("all").undated)).toEqual(["e", "d", "b"]);
    const all = projectWorkspaceOverview(snapshot, snapshot.projects, {
      ...multiViewContext,
      scope: "all",
    });
    expect(
      ids(Object.values(workbenchTaskGroups(all.tasks, "2026-10-19")).flat()),
    ).toEqual(["a", "c"]);
  });

  it("sorts by deadline then title and id without changing the source array or task objects", () => {
    const base = multiViewFixture().tasks.find((task) => task.id === "a")!;
    const task = (id: string, title: string, dueDate: string | null): Task => ({
      ...base,
      id,
      title,
      dueDate,
    });
    const source = Object.freeze([
      task("no-date-z", "Z", null),
      task("later", "A", "2026-10-21"),
      task("tie-b", "A", "2026-10-20"),
      task("tie-a", "A", "2026-10-20"),
      task("same-date-z", "Z", "2026-10-20"),
      task("no-date-a", "A", null),
    ]);
    const before = structuredClone(source);
    const groups = workbenchTaskGroups(source);
    expect(ids(groups.scheduled)).toEqual([
      "tie-a",
      "tie-b",
      "same-date-z",
      "later",
      "no-date-a",
      "no-date-z",
    ]);
    expect(source).toEqual(before);
    expect(groups.scheduled[0]).toBe(source[3]);
  });
});

describe("workspace workbench selected day", () => {
  const days = calendarWindow("2026-10-19", "week").days;
  it("accepts every date in the current workspace week", () => {
    for (const day of days) expect(validWorkbenchDay(day, days)).toBe(day);
  });
  it("ignores malformed, repeated and out-of-week URL values", () => {
    for (const value of [
      undefined,
      null,
      "",
      ["2026-10-19"],
      ["2026-10-19", "2026-10-20"],
      "2026-10-18",
      "2026-10-26",
      "2026-10-19T00:00:00Z",
      "2026-02-30",
      "not-a-date",
    ]) {
      const selectedDay = validWorkbenchDay(value, days);
      expect(selectedDay).toBe("");
      const snapshot = multiViewFixture();
      const tasks = projectWorkspaceOverview(snapshot, snapshot.projects, {
        ...multiViewContext,
        scope: "week",
      }).tasks;
      expect(workbenchTaskGroups(tasks, selectedDay)).toEqual(
        workbenchTaskGroups(tasks),
      );
    }
    expect(validWorkbenchDay("2026-02-30", ["2026-02-30"])).toBe("");
  });
});
