import { describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { projectCollectionProjection } from "../../packages/domain/project-collection";
const now = new Date("2026-10-16T12:00:00Z");
describe("project collection layouts", () => {
  it("partitions the same business projects exactly once and retains archived or unknown stages", () => {
    const seed = createSeed(now);
    const projects = seed.projects.slice(0, 4);
    projects[0]!.stage = "active";
    projects[1]!.stage = "archived";
    projects[2]!.stage = "legacy";
    projects[3]!.intakeInbox = true;
    const before = JSON.stringify(projects);
    const result = projectCollectionProjection(
      projects,
      seed.tasks,
      [
        { id: "active", order: 1 },
        { id: "archived", order: 2, archived: true },
        { id: "unused", order: 3, archived: true },
      ],
      { now },
    );
    expect(
      result.columns
        .flatMap((column) => column.projects.map((project) => project.id))
        .sort(),
    ).toEqual(
      projects
        .slice(0, 3)
        .map((project) => project.id)
        .sort(),
    );
    expect(
      result.columns.find((column) => column.id === "archived")?.archived,
    ).toBe(true);
    expect(
      result.columns.find((column) => column.id === "legacy")?.unknown,
    ).toBe(true);
    expect(result.columns.some((column) => column.id === "unused")).toBe(false);
    expect(result.inbox.map((project) => project.id)).toEqual([
      projects[3]!.id,
    ]);
    expect(JSON.stringify(projects)).toBe(before);
  });
  it("uses full-graph leaves for all-date risk and selected-scope planned counts", () => {
    const seed = createSeed(now);
    const project = seed.projects[0]!;
    const base = seed.tasks[0]!;
    const tasks = [
      {
        ...base,
        id: "parent",
        projectId: project.id,
        parentId: null,
        dueDate: "2020-01-01",
      },
      {
        ...base,
        id: "child",
        projectId: project.id,
        parentId: "parent",
        status: "blocked" as const,
        dueDate: "2026-10-15",
        workWeek: "2026-10-12",
        workDates: ["2026-10-16"],
      },
      {
        ...base,
        id: "unplanned",
        projectId: project.id,
        parentId: null,
        status: "todo" as const,
        dueDate: null,
        workWeek: null,
        workDates: [],
      },
      {
        ...base,
        id: "done",
        projectId: project.id,
        parentId: null,
        status: "done" as const,
        dueDate: "2026-10-01",
        workWeek: null,
        workDates: [],
      },
    ];
    const result = projectCollectionProjection([project], tasks, [], {
      now,
      timeZone: "UTC",
      scope: "today",
    });
    expect(result.stats.get(project.id)).toEqual({
      total: 3,
      open: 2,
      done: 1,
      blocked: 1,
      overdue: 1,
      planned: 1,
    });
    expect(projectCollectionProjection([], tasks, [], { now }).stats.size).toBe(
      0,
    );
  });
});
