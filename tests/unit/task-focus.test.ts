import { describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { leafTasks, statistics } from "../../packages/domain/types";
import {
  filterTaskWork,
  readTaskFilters,
  readProjectTaskFilters,
  selectedTaskState,
  taskStateFilter,
  taskStates,
} from "../../apps/web/src/composables/task-focus";

const now = new Date("2026-10-10T12:00:00Z");

describe("task focus and shareable filters", () => {
  it("scopes project views to the route project even when a copied link names another project", () => {
    const seed = createSeed(now);
    const project = seed.projects[0]!;
    const other = seed.projects[1]!;
    const filters = readProjectTaskFilters({ project: other.id }, project.id);
    expect(filters.scope).toBe("all");
    const matched = filterTaskWork(seed.tasks, filters, now);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((task) => task.projectId === project.id)).toBe(true);
    expect(
      filterTaskWork(
        seed.tasks,
        readProjectTaskFilters({ projects: [other.id] }, project.id),
        now,
      ),
    ).toEqual([]);
    expect(
      readProjectTaskFilters(
        { scope: "today", status: "done", q: "review", view: "board" },
        project.id,
      ),
    ).toMatchObject({
      scope: "today",
      status: "done",
      query: "review",
      project: project.id,
    });
  });
  it("retains identity and risk intent in links without widening invalid values", () => {
    const seed = createSeed(now);
    const leaf = leafTasks(seed.tasks)[0]!;
    leaf.assigneeId = "member-a";
    const filters = readTaskFilters({
      scope: "all",
      assignee: "member:member-a",
    });
    expect(
      filterTaskWork(seed.tasks, filters, now).map((task) => task.id),
    ).toEqual([leaf.id]);
    for (const query of [
      { assignee: ["me", "none"] },
      { risk: ["overdue"] },
      { risk: "unknown" },
    ]) {
      expect(
        filterTaskWork(
          seed.tasks,
          readTaskFilters({ scope: "all", ...query }),
          now,
        ),
      ).toEqual([]);
    }
    expect(
      filterTaskWork(
        seed.tasks,
        readTaskFilters({ scope: "all", assignee: "me" }),
        now,
        [],
        "UTC",
        "member-a",
      ).map((task) => task.id),
    ).toEqual([leaf.id]);
  });
  it("defaults to the current week with all work visible", () => {
    const seed = createSeed(now);
    const filters = readTaskFilters({});
    const selected = filterTaskWork(seed.tasks, filters, now);
    expect(filters).toEqual({
      scope: "week",
      status: "",
      project: "",
      query: "",
      focus: "all",
    });
    expect(statistics(selected, "all", now)).toMatchObject({
      total: 24,
      todo: 4,
      in_progress: 8,
      done: 10,
      blocked: 2,
    });
  });

  it("restores the entire filter intent from a prior URL without sticky state", () => {
    const prior = {
      scope: "today",
      status: "todo",
      project: "project-1",
      q: "scope",
      focus: "open",
    };
    const priorFilters = readTaskFilters(prior);
    expect(priorFilters).toEqual({
      scope: "today",
      status: "todo",
      project: "project-1",
      query: "scope",
      focus: "all",
    });
    expect(readTaskFilters({ scope: "all", focus: "done" })).toEqual({
      scope: "all",
      status: "",
      project: "",
      query: "",
      focus: "done",
    });
    expect(readTaskFilters(prior)).toEqual(priorFilters);
  });

  it("ignores invalid or repeated query values without hiding the whole workspace", () => {
    expect(
      readTaskFilters({
        scope: ["today", "all"],
        status: "unknown",
        focus: "admin",
        project: ["project-1"],
        q: null,
      }),
    ).toEqual({
      scope: "week",
      status: "",
      project: "",
      query: "",
      focus: "all",
    });
  });

  it("partitions leaf work into completed and open, including coordination work as open", () => {
    const seed = createSeed(now);
    const all = filterTaskWork(
      seed.tasks,
      readTaskFilters({ scope: "all" }),
      now,
    );
    const open = filterTaskWork(
      seed.tasks,
      readTaskFilters({ scope: "all", focus: "open" }),
      now,
    );
    const done = filterTaskWork(
      seed.tasks,
      readTaskFilters({ scope: "all", focus: "done" }),
      now,
    );
    expect([all.length, open.length, done.length]).toEqual([150, 60, 90]);
    expect(open.some((task) => task.status === "blocked")).toBe(true);
    expect(new Set([...open, ...done].map((task) => task.id)).size).toBe(
      all.length,
    );
    expect(open.every((task) => !done.includes(task))).toBe(true);
  });

  it("uses the explicit status in legacy links instead of retaining a contradictory hidden focus", () => {
    const seed = createSeed(now);
    expect(
      filterTaskWork(
        seed.tasks,
        readTaskFilters({ scope: "all", status: "done", focus: "open" }),
        now,
      ),
    ).toEqual(
      filterTaskWork(
        seed.tasks,
        readTaskFilters({ scope: "all", status: "done" }),
        now,
      ),
    );
    const selected = filterTaskWork(
      seed.tasks,
      readTaskFilters({
        scope: "all",
        status: "todo",
        project: "project-1",
        focus: "open",
      }),
      now,
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(
      selected.every(
        (task) => task.status === "todo" && task.projectId === "project-1",
      ),
    ).toBe(true);
  });
  it("represents each visible state as one mutually exclusive choice", () => {
    for (const state of taskStates) {
      const filters = {
        ...readTaskFilters({ scope: "all" }),
        ...taskStateFilter(state),
      };
      expect(selectedTaskState(filters)).toBe(state);
      expect(filters.status && filters.focus !== "all").toBeFalsy();
    }
    expect(selectedTaskState(readTaskFilters({ focus: "done" }))).toBe("done");
    expect(selectedTaskState(readTaskFilters({ focus: "open" }))).toBe("open");
  });

  it("keeps work scope independent of due dates and never invents plans for undated tasks", () => {
    const seed = createSeed(now);
    const filters = readTaskFilters({ scope: "today" });
    const originalIds = filterTaskWork(seed.tasks, filters, now).map(
      (task) => task.id,
    );
    expect(originalIds).toHaveLength(8);
    const changedDeadlines = seed.tasks.map((task) => ({
      ...task,
      dueDate: null,
    }));
    expect(
      filterTaskWork(changedDeadlines, filters, now).map((task) => task.id),
    ).toEqual(originalIds);
    const unplanned = leafTasks(seed.tasks).find((task) => !task.workWeek)!;
    expect(unplanned).toBeDefined();
    const dueToday = seed.tasks.map((task) =>
      task.id === unplanned.id ? { ...task, dueDate: "2026-10-10" } : task,
    );
    expect(
      filterTaskWork(dueToday, filters, now).some(
        (task) => task.id === unplanned.id,
      ),
    ).toBe(false);
    expect(
      filterTaskWork(dueToday, readTaskFilters({ scope: "all" }), now).some(
        (task) => task.id === unplanned.id,
      ),
    ).toBe(true);
  });

  it("excludes parents before scope or search filters remove their children", () => {
    const seed = createSeed(now);
    const parent = seed.tasks.find((task) =>
      seed.tasks.some((child) => child.parentId === task.id),
    )!;
    parent.title = "Unique parent-only text";
    parent.status = "done";
    expect(
      filterTaskWork(
        seed.tasks,
        readTaskFilters({ scope: "all", q: parent.title, focus: "done" }),
        now,
      ),
    ).toEqual([]);
  });

  it("searches supplied title and assignee text without translating or mutating it", () => {
    const seed = createSeed(now);
    const leaf = leafTasks(seed.tasks)[0]!;
    leaf.title = "中文验收 • Customer Review";
    leaf.assignee = "王敏 · TESTER";
    const before = JSON.stringify(seed.tasks);
    for (const q of ["中文验收", " customer review ", "tester", "王敏"]) {
      expect(
        filterTaskWork(
          seed.tasks,
          readTaskFilters({ scope: "all", q }),
          now,
        ).map((task) => task.id),
      ).toContain(leaf.id);
    }
    expect(JSON.stringify(seed.tasks)).toBe(before);
  });
});
