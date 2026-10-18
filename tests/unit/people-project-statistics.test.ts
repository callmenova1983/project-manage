import { describe, it, expect } from "vitest";
import { multiViewFixture, multiViewContext } from "../fixtures/multi-view";
import {
  projectStatistics,
  statisticsTasks,
} from "../../packages/domain/people-project-statistics";
import {
  defaultStatisticsQuery,
  readStatisticsQuery,
} from "../../packages/domain/statistics-query";
describe("person/project statistics", () => {
  it("keeps attention groups whole and drilldowns reconcile", () => {
    const snapshot = multiViewFixture();
    snapshot.projects.forEach((p) => {
      p.owner = "于谦";
      p.ownerId = null;
    });
    const q = defaultStatisticsQuery();
    const all = projectStatistics(snapshot, q, multiViewContext);
    const filtered = projectStatistics(
      snapshot,
      { ...q, attention: "blocked" },
      multiViewContext,
    );
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.totals).toEqual(all.totals);
    for (const row of all.rows)
      for (const kind of [
        "total",
        "open",
        "done",
        "blocked",
        "overdue",
      ] as const)
        expect(statisticsTasks(row, kind, all.today)).toHaveLength(row[kind]);
  });
  it("never promotes parents when restricting project scope and excludes voided leaves", () => {
    const snapshot = multiViewFixture();
    const result = projectStatistics(
      snapshot,
      { ...defaultStatisticsQuery(), projects: ["p1"] },
      multiViewContext,
    );
    const parentIds = new Set(snapshot.tasks.map((t) => t.parentId));
    expect(
      result.rows
        .flatMap((r) => r.tasks)
        .every(
          (t) => t.projectId === "p1" && !t.voided && !parentIds.has(t.id),
        ),
    ).toBe(true);
  });
  it("keeps missing projects empty and rejects invalid queries", () => {
    expect(
      projectStatistics(multiViewFixture(), {
        ...defaultStatisticsQuery(),
        projects: ["deleted"],
      }).rows,
    ).toEqual([]);
    expect(readStatisticsQuery({ attention: "unsupported" }).query).toBeNull();
  });
  it("separates same-name account and text owners, counts empty projects, searches pinyin", () => {
    const snapshot = multiViewFixture();
    snapshot.projects[0]!.owner = "于谦";
    snapshot.projects[0]!.ownerId = "unknown-member";
    snapshot.projects[1]!.owner = "于谦";
    snapshot.projects[1]!.ownerId = null;
    snapshot.tasks = [];
    const result = projectStatistics(snapshot, {
      ...defaultStatisticsQuery(),
      search: "yq",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.totals.projects).toBe(2);
    expect(result.totals.total).toBe(0);
    expect(
      projectStatistics(snapshot, {
        ...defaultStatisticsQuery(),
        view: "tasks",
      }).rows,
    ).toHaveLength(0);
  });
  it("task perspective preserves assigned task totals and deduplicates project totals", () => {
    const snapshot = multiViewFixture();
    const q = defaultStatisticsQuery();
    const owned = projectStatistics(snapshot, q, multiViewContext);
    const assigned = projectStatistics(
      snapshot,
      { ...q, view: "tasks" },
      multiViewContext,
    );
    expect(assigned.totals.total).toBe(owned.totals.total);
    expect(assigned.totals.projects).toBeLessThanOrEqual(
      snapshot.projects.length,
    );
    const none = assigned.rows.findIndex((r) => r.key === "none");
    if (none >= 0) expect(none).toBe(assigned.rows.length - 1);
  });
});

it("combines project/stage OR scopes with person AND and sorts the full result numerically", () => {
  const snapshot = multiViewFixture();
  const p = snapshot.projects[0]!;
  const t = snapshot.tasks.find((t) => !t.parentId && !t.voided)!;
  snapshot.projects = Array.from({ length: 35 }, (_, i) => ({
    ...p,
    id: `p-${i}`,
    stage: i % 2 ? "active" : "planning",
    owner: `负责人${i}`,
    ownerId: null,
  }));
  snapshot.tasks = snapshot.projects.flatMap((p, i) =>
    Array.from({ length: i + 1 }, (_, j) => ({
      ...t,
      id: `${p.id}-${j}`,
      projectId: p.id,
      parentId: null,
      voided: undefined,
      status: "todo" as const,
      dueDate: null,
    })),
  );
  const query = {
    ...defaultStatisticsQuery(),
    sort: "total" as const,
    direction: "desc" as const,
  };
  const all = projectStatistics(snapshot, query);
  expect(all.rows[0]!.total).toBe(35);
  expect(all.rows[25]!.total).toBe(10);
  expect(all.totals.total).toBe(630);
  const scoped = projectStatistics(snapshot, {
    ...query,
    projects: ["p-1", "p-2", "p-3"],
    stages: ["active"],
    search: "负责人",
  });
  expect(scoped.rows.map((r) => r.total)).toEqual([4, 2]);
  expect(scoped.totals.total).toBe(6);
});

it("handles timezone-specific overdue and explicit assignment without conflating project owners", () => {
  const snapshot = multiViewFixture();
  snapshot.projects.forEach((p) => {
    p.owner = "项目甲";
    p.ownerId = null;
  });
  const source = snapshot.tasks[0]!;
  snapshot.tasks = [
    {
      ...source,
      id: "due",
      parentId: null,
      voided: undefined,
      status: "todo",
      dueDate: "2026-10-18",
      assignee: "任务乙",
      assigneeId: null,
    },
    {
      ...source,
      id: "done",
      parentId: null,
      voided: undefined,
      status: "done",
      dueDate: "2026-10-18",
      assignee: "任务乙",
      assigneeId: null,
    },
  ];
  const q = defaultStatisticsQuery();
  const utc = projectStatistics(snapshot, q, {
    now: new Date("2026-10-18T16:05:00Z"),
    timeZone: "UTC",
  });
  const cn = projectStatistics(snapshot, q, multiViewContext);
  expect(utc.totals.overdue).toBe(0);
  expect(cn.totals.overdue).toBe(1);
  expect(cn.rows[0]!.name).toBe("项目甲");
  expect(
    projectStatistics(snapshot, { ...q, view: "tasks" }, multiViewContext)
      .rows[0]!.name,
  ).toBe("任务乙");
});
