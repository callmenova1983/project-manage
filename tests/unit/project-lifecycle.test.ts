import { afterEach, expect, it, vi } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  planProjectLifecycle,
  projectLifecycle,
  projectOpenTasks,
} from "../../packages/domain/project-lifecycle";
import {
  selectProjects,
  readProjectViewQuery,
  projectViewQuery,
  projectWorkspaceOverview,
} from "../../packages/domain/project-view";
import { deriveNotifications } from "../../packages/domain/notifications";
import { createLocalApi } from "../../apps/web/src/services/local";
import { projectInput, taskInput } from "../../packages/domain/types";
import { projectStatistics } from "../../packages/domain/people-project-statistics";
import { defaultStatisticsQuery } from "../../packages/domain/statistics-query";

afterEach(() => vi.unstubAllGlobals());
function localApi() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return createLocalApi();
}

it("keeps legacy projects active and round-trips lifecycle filters without losing history", () => {
  const seed = createSeed();
  const [a, b, c] = seed.projects;
  const historical = projectStatistics(seed, defaultStatisticsQuery()).totals;
  b!.lifecycle = "closed";
  c!.lifecycle = "archived";
  expect(projectLifecycle(a!)).toBe("active");
  expect(selectProjects(seed.projects)).not.toContain(b);
  expect(selectProjects(seed.projects, [], { lifecycle: "closed" })).toEqual([
    b,
  ]);
  expect(selectProjects(seed.projects, [], { lifecycle: "archived" })).toEqual([
    c,
  ]);
  expect(selectProjects(seed.projects, [], { lifecycle: "all" })).toHaveLength(
    seed.projects.length,
  );
  const filters = readProjectViewQuery({ lifecycle: "closed", q: "school" });
  expect(projectViewQuery(filters)).toMatchObject({
    lifecycle: "closed",
    q: "school",
  });
  expect(readProjectViewQuery({ lifecycle: "unknown" }).invalid).toBe(true);
  expect(readProjectViewQuery({ lifecycle: ["closed"] }).invalid).toBe(true);
  const overview = projectWorkspaceOverview(
    seed,
    selectProjects(seed.projects),
  );
  expect(overview.projectIds).not.toContain(b!.id);
  expect(seed.projects).toContain(b);
  expect(projectStatistics(seed, defaultStatisticsQuery()).totals).toEqual(
    historical,
  );
});

it("requires confirmation for unfinished leaf tasks and never changes task status or project stage", () => {
  const seed = createSeed(),
    project = seed.projects[0]!;
  const before = JSON.stringify(seed);
  expect(projectOpenTasks(project.id, seed.tasks).length).toBeGreaterThan(0);
  expect(() =>
    planProjectLifecycle(project, seed.tasks, {
      version: project.version,
      lifecycle: "closed",
    }),
  ).toThrow(/unfinished/);
  const closed = planProjectLifecycle(project, seed.tasks, {
    version: project.version,
    lifecycle: "closed",
    confirmOpenTasks: true,
  });
  expect(closed).toMatchObject({
    stage: project.stage,
    lifecycle: "closed",
    version: project.version + 1,
  });
  expect(() =>
    planProjectLifecycle(closed, seed.tasks, {
      version: project.version,
      lifecycle: "active",
    }),
  ).toThrow(/changed/);
  expect(JSON.stringify(seed)).toBe(before);
  expect(
    planProjectLifecycle(closed, seed.tasks, {
      version: closed.version,
      lifecycle: "closed",
    }),
  ).toBe(closed);
  const task = seed.tasks.find(
    (t) =>
      t.projectId === project.id &&
      !seed.tasks.some((child) => child.parentId === t.id),
  )!;
  expect(
    projectOpenTasks(project.id, [
      {
        ...task,
        voided: {
          at: new Date().toISOString(),
          actor: "A",
          actorId: "a",
          reason: "duplicate",
          batchId: "batch",
        },
      },
    ]),
  ).toEqual([]);
});

it("keeps close/archive/reactivate history through reloads and protects archived local batch writes", async () => {
  const api = localApi(),
    before = await api.snapshot(),
    project = before.projects[0]!;
  const originalTasks = before.tasks.filter((t) => t.projectId === project.id);
  const closed = await api.changeProjectLifecycle(project.id, {
    version: project.version,
    lifecycle: "closed",
    confirmOpenTasks: true,
  });
  const noted = await api.saveProject(
    { ...projectInput.strip().parse(closed), notes: "保留维修说明" },
    closed.id,
    closed.version,
  );
  expect(noted.lifecycle).toBe("closed");
  const archived = await api.changeProjectLifecycle(project.id, {
    version: noted.version,
    lifecycle: "archived",
    confirmOpenTasks: true,
  });
  const checkpoint = await api.snapshot();
  const task = originalTasks.find(
    (t) => !originalTasks.some((child) => child.parentId === t.id),
  )!;
  await expect(
    api.saveTask(
      { ...taskInput.strip().parse(task), title: "forbidden" },
      task.id,
      task.version,
    ),
  ).rejects.toThrow(/archived/);
  expect(await api.snapshot()).toEqual(checkpoint);
  await expect(
    api.addProgress(project.id, {
      version: archived.version,
      mode: "new",
      text: "forbidden",
    }),
  ).rejects.toThrow(/archived/);
  expect(await api.snapshot()).toEqual(checkpoint);
  await expect(
    api.renameProject(project.id, "forbidden", archived.version),
  ).rejects.toThrow(/archived/);
  expect(await api.snapshot()).toEqual(checkpoint);
  const reloaded = createLocalApi();
  const active = await reloaded.changeProjectLifecycle(project.id, {
    version: archived.version,
    lifecycle: "active",
  });
  expect(active.notes).toBe("保留维修说明");
  const final = await reloaded.snapshot();
  expect(final.tasks.filter((t) => t.projectId === project.id)).toEqual(
    originalTasks,
  );
  expect(
    final.activities
      .filter(
        (a) => a.entityId === project.id && a.source === "Project lifecycle",
      )
      .map((a) => a.action),
  ).toEqual(["Reactivated project", "Archived project", "Closed project"]);
  const exported = await reloaded.exportData();
  expect(exported.projects.find((p) => p.id === project.id)?.lifecycle).toBe(
    "active",
  );
});

it("suppresses daily risks and missing-field reminders for closed and archived projects", () => {
  const seed = createSeed();
  const project = seed.projects[0]!;
  project.ownerId = "member";
  project.owner = "";
  seed.members = [
    { id: "member", name: "Member", email: "m@example.test", status: "active" },
  ];
  seed.tasks
    .filter((t) => t.projectId === project.id)
    .forEach((t) => {
      t.assigneeId = "member";
      t.dueDate = "2020-01-01";
    });
  const now = new Date("2026-10-23T00:00:00Z");
  expect(
    deriveNotifications(seed, "member", now).some(
      (n) => n.projectId === project.id,
    ),
  ).toBe(true);
  for (const lifecycle of ["closed", "archived"] as const) {
    project.lifecycle = lifecycle;
    expect(
      deriveNotifications(seed, "member", now).filter(
        (n) => n.projectId === project.id,
      ),
    ).toEqual([]);
  }
});
