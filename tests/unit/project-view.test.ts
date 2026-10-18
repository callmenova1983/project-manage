import { describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  projectOwnerKey,
  projectViewQuery,
  readProjectViewQuery,
  selectProjects,
  projectWorkspaceOverview,
} from "../../packages/domain/project-view";
import { createTaskViewIndex } from "../../packages/domain/task-view";
import { readTaskFilters } from "../../apps/web/src/composables/task-focus";
import type { Member } from "../../packages/domain/types";
const now = new Date("2026-10-18T16:05:00Z");
const members: Member[] = [
  { id: "a", name: "王敏", email: "a@example.test", status: "active" },
  { id: "b", name: "王敏", email: "b@example.test", status: "disabled" },
];

describe("shared project collection", () => {
  it("searches project names, short names and aliases by full pinyin and initials", () => {
    const projects = createSeed(now).projects.slice(0, 2);
    Object.assign(projects[0]!, {
      name: "大榭岛码头",
      shortName: "宁波港",
      aliases: ["海关缉私局", "智慧AI平台2期"],
    });
    const before = JSON.stringify(projects);
    for (const query of [
      "daxiedaomatou",
      "DXDMT",
      " da xie dao ",
      "ningbogang",
      "nbg",
      "haiguanjisiju",
      "hgjsj",
      "zhihuiAIpingtai2qi",
    ]) {
      expect(
        selectProjects(projects, [], { query }).map((p) => p.id),
        query,
      ).toEqual([projects[0]!.id]);
    }
    expect(
      selectProjects(projects, [], { query: "dxdmt", followedOnly: true }),
    ).toEqual([]);
    expect(selectProjects(projects, [], { query: "doesnotexist" })).toEqual([]);
    expect(JSON.stringify(projects)).toBe(before);
    projects[0]!.name = "湖州项目";
    projects[0]!.shortName = "";
    projects[0]!.aliases = [];
    expect(selectProjects(projects, [], { query: "dxdmt" })).toEqual([]);
    expect(selectProjects(projects, [], { query: "hzxm" })).toEqual([
      projects[0],
    ]);
  });
  it("combines identity, channel, category, follow and text filters without mutating shared data", () => {
    const seed = createSeed(now);
    const [a, b, c] = seed.projects;
    Object.assign(a!, {
      owner: "旧名",
      ownerId: "a",
      channelId: "company",
      categoryIds: ["delivery"],
    });
    Object.assign(b!, {
      owner: "王敏",
      ownerId: "b",
      channelId: "company",
      categoryIds: ["delivery"],
    });
    Object.assign(c!, {
      owner: "王敏",
      ownerId: null,
      channelId: "other",
      categoryIds: ["delivery"],
    });
    const before = JSON.stringify(seed);
    const rows = selectProjects(
      seed.projects,
      members,
      {
        query: "王敏",
        owner: projectOwnerKey(a!),
        channel: "company",
        category: "delivery",
        followedOnly: true,
      },
      new Set([a!.id, b!.id]),
    );
    expect(rows.map((project) => project.id)).toEqual([a!.id]);
    expect(
      selectProjects(seed.projects, members, { owner: "member:b" }).map(
        (project) => project.id,
      ),
    ).toEqual([b!.id]);
    expect(
      selectProjects(seed.projects, members, { owner: "text:王敏" }).map(
        (project) => project.id,
      ),
    ).toEqual([c!.id]);
    expect(JSON.stringify(seed)).toBe(before);
  });
  it("keeps manual order and deterministic ties across collection layouts", () => {
    const projects = createSeed(now).projects.slice(0, 3);
    expect(
      selectProjects(
        projects,
        [],
        { sort: "manual" },
        new Set(),
        projects.map((project) => project.id).reverse(),
      ).map((project) => project.id),
    ).toEqual(projects.map((project) => project.id).reverse());
    for (const project of projects) project.name = "Same";
    expect(
      selectProjects([...projects].reverse(), [], { sort: "name" }).map(
        (project) => project.id,
      ),
    ).toEqual(projects.map((project) => project.id).sort());
  });
  it("round-trips explicit query filters and refuses malformed or repeated values", () => {
    const filters = {
      query: "Customer review",
      stage: "implementation",
      owner: "member:a",
      channel: "company",
      category: "delivery",
      discipline: "Delivery",
      followedOnly: true,
      sort: "name" as const,
    };
    expect(readProjectViewQuery(projectViewQuery(filters))).toEqual({
      ...filters,
      invalid: false,
    });
    for (const query of [
      { stage: ["potential", "operations"] },
      { owner: null },
      { follow: "admin" },
    ]) {
      const read = readProjectViewQuery(query);
      expect(read.invalid).toBe(true);
      expect(selectProjects(createSeed(now).projects, members, read)).toEqual(
        [],
      );
    }
  });
});

describe("overview and task drill-down", () => {
  it("keeps all-date risks separate from current work scope and excludes the intake inbox", () => {
    const seed = createSeed(now);
    const project = seed.projects[0]!;
    seed.projects[1]!.intakeInbox = true;
    const base = seed.tasks.find(
      (task) =>
        !seed.tasks.some((child) => child.parentId === task.id) &&
        task.projectId === project.id,
    )!;
    base.status = "blocked";
    base.workWeek = null;
    base.workDates = [];
    base.dueDate = "2026-10-18";
    const result = projectWorkspaceOverview(
      seed,
      [project, seed.projects[1]!],
      { now, timeZone: "Asia/Shanghai", scope: "week" },
    );
    expect(result.projectIds).toEqual([project.id]);
    expect(result.selected.open.some((task) => task.id === base.id)).toBe(
      false,
    );
    expect(result.all.blocked.some((task) => task.id === base.id)).toBe(true);
    expect(result.all.overdue.some((task) => task.id === base.id)).toBe(true);
    expect(result.all.unplanned.some((task) => task.id === base.id)).toBe(true);
    const query = readTaskFilters({
      scope: "all",
      projects: result.projectIds,
      risk: "overdue",
    });
    const drill = createTaskViewIndex(seed.tasks, {
      now,
      timeZone: "Asia/Shanghai",
    }).select(query);
    expect(drill.map((task) => task.id)).toEqual(
      result.all.overdue.map((task) => task.id),
    );
    expect(result.stages[project.stage]?.projects).toBe(1);
  });
  it("does not widen an empty project scope or miscount parents", () => {
    const seed = createSeed(now);
    const empty = projectWorkspaceOverview(seed, [], { now });
    expect(empty.tasks).toEqual([]);
    expect(empty.all.total).toBe(0);
    const index = createTaskViewIndex(seed.tasks, { now });
    expect(
      index.select(readTaskFilters({ scope: "all", projects: "" })),
    ).toEqual([]);
    expect(
      index.select(
        readTaskFilters({
          scope: "all",
          projects: [seed.projects[0]!.id, null],
        }),
      ),
    ).toEqual([]);
    const ids = [seed.projects[0]!.id, seed.projects[1]!.id];
    const query = readTaskFilters({
      scope: "all",
      projects: [...ids, ids[0]!],
    });
    expect(query.projects).toEqual(ids);
    const selected = index.select(query);
    expect(selected.every((task) => ids.includes(task.projectId))).toBe(true);
    expect(
      selected.some((task) =>
        seed.tasks.some((child) => child.parentId === task.id),
      ),
    ).toBe(false);
  });
});
