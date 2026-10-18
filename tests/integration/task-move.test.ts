import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../apps/api/src/app";
import { Repository } from "../../apps/api/src/database";
import { createUser } from "../../apps/api/src/auth";
import { manualTaskOrder } from "../../packages/domain/task-move";
import { taskInput, type Task } from "../../packages/domain/types";
let context: Awaited<ReturnType<typeof buildApp>>,
  tasks: Task[],
  cookie: string,
  csrf: string;
const origin = "http://localhost:4173";
const request = (id: string, body: unknown, key = randomUUID()) =>
  context.app.inject({
    method: "POST",
    url: `/api/tasks/${id}/move`,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
    payload: body as Record<string, unknown>,
  });
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("team");
  await createUser(context.repo, {
    email: "move@example.test",
    name: "Mover",
    workspaceId: "team",
    password: "synthetic-move-test-password",
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "move@example.test",
      password: "synthetic-move-test-password",
    },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
  const initial = context.repo.snapshot("team"),
    project = { ...initial.projects[0]!, id: "move-project" };
  context.repo.putProject("team", project);
  tasks = ["a", "b", "c"].map((id, sortOrder) => ({
    ...initial.tasks[0]!,
    id: `move-${id}`,
    title: id,
    projectId: project.id,
    parentId: null,
    version: 1,
    sortOrder,
    workDates: [],
    workWeek: null,
    scheduleStart: null,
    scheduleEnd: null,
    milestone: false,
    dependencies: [],
  }));
  for (const task of tasks) context.repo.putTask("team", task);
});
afterEach(() => context.app.close());
it("atomically saves order, preserves it in normal updates and exports, and replays a move once", async () => {
  const source = tasks[2]!,
    anchor = tasks[0]!,
    key = randomUUID();
  const input = {
    version: source.version,
    parentId: null,
    anchorId: anchor.id,
    anchorVersion: anchor.version,
    placement: "before",
  };
  const first = await request(source.id, input, key);
  expect(first.statusCode).toBe(200);
  const after = context.repo.snapshot("team");
  expect(
    manualTaskOrder(after.tasks)
      .filter((task) => task.projectId === source.projectId)
      .map((task) => task.id),
  ).toEqual([source.id, tasks[0]!.id, tasks[1]!.id]);
  expect((await request(source.id, input, key)).json()).toEqual(first.json());
  expect(context.repo.snapshot("team")).toEqual(after);
  const current = after.tasks.find((task) => task.id === source.id)!;
  const edited = await context.app.inject({
    method: "PUT",
    url: `/api/tasks/${current.id}`,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: {
      ...taskInput.strip().parse(current),
      version: current.version,
      title: "Edited after moving",
    },
  });
  expect(edited.statusCode).toBe(200);
  expect(edited.json().sortOrder).toBe(current.sortOrder);
  const added = await context.app.inject({
    method: "POST",
    url: "/api/tasks",
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: { ...taskInput.strip().parse(current), title: "New task appends" },
  });
  expect(added.statusCode).toBe(200);
  expect(added.json().sortOrder).toBeGreaterThan(
    Math.max(
      ...after.tasks
        .filter((task) => task.projectId === source.projectId)
        .map((task) => task.sortOrder!),
    ),
  );
  const exported = await context.app.inject({
    method: "GET",
    url: "/api/export",
    headers: { cookie },
  });
  expect(exported.statusCode).toBe(200);
  expect(
    exported.json().tasks.find((task: Task) => task.id === source.id).sortOrder,
  ).toBe(current.sortOrder);
  const imported = await context.app.inject({
    method: "POST",
    url: "/api/import",
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: { ...exported.json<Record<string, unknown>>(), confirmed: true },
  });
  expect(imported.statusCode).toBe(200);
  expect(
    imported.json().tasks.find((task: Task) => task.id === source.id).sortOrder,
  ).toBe(current.sortOrder);
});
it("moves descendants together and rejects cycles/stale parents without partial tasks, history or revision writes", async () => {
  const source = tasks[0]!,
    parent = tasks[1]!,
    child = { ...tasks[2]!, parentId: source.id };
  context.repo.putTask("team", child);
  const result = await request(source.id, {
    version: source.version,
    parentId: parent.id,
    parentVersion: parent.version,
    placement: "last",
  });
  expect(result.statusCode).toBe(200);
  const moved = context.repo.snapshot("team");
  expect(moved.tasks.find((task) => task.id === source.id)!.parentId).toBe(
    parent.id,
  );
  expect(moved.tasks.find((task) => task.id === child.id)!.parentId).toBe(
    source.id,
  );
  const currentParent = moved.tasks.find((task) => task.id === parent.id)!;
  expect(currentParent.version).toBe(2);
  const cycle = await request(currentParent.id, {
    version: currentParent.version,
    parentId: child.id,
    parentVersion: child.version,
    placement: "last",
  });
  expect(cycle.statusCode).toBe(400);
  expect(context.repo.snapshot("team")).toEqual(moved);
  const stale = await request(child.id, {
    version: child.version,
    parentId: parent.id,
    parentVersion: 1,
    placement: "last",
  });
  expect(stale.statusCode).toBe(409);
  expect(context.repo.snapshot("team")).toEqual(moved);
});
it("rejects scheduled parents, cross-project anchors and stale source rows atomically", async () => {
  const source = tasks[0]!,
    parent = {
      ...tasks[1]!,
      scheduleStart: "2026-10-19",
      scheduleEnd: "2026-10-20",
    };
  context.repo.putTask("team", parent);
  const before = context.repo.snapshot("team"),
    foreign = before.tasks.find((task) => task.projectId !== source.projectId)!;
  for (const [body, status] of [
    [
      {
        version: source.version,
        parentId: parent.id,
        parentVersion: parent.version,
        placement: "last",
      },
      400,
    ],
    [
      {
        version: source.version,
        parentId: null,
        anchorId: foreign.id,
        anchorVersion: foreign.version,
        placement: "before",
      },
      400,
    ],
    [{ version: source.version + 1, parentId: null, placement: "last" }, 409],
  ] as const) {
    expect((await request(source.id, body)).statusCode).toBe(status);
    expect(context.repo.snapshot("team")).toEqual(before);
  }
});
it("migrates old rows to the exact existing sibling order without changing task versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "pm-task-order-"));
  let repo: Repository | undefined;
  try {
    const path = join(directory, "tasks.sqlite");
    repo = new Repository(path);
    repo.seed("legacy");
    repo.db.exec(
      "UPDATE tasks SET data=json_remove(data, '$.sortOrder'); DELETE FROM migrations WHERE version=19;",
    );
    const before = repo.snapshot("legacy").tasks;
    repo.close();
    repo = new Repository(path);
    const after = repo.snapshot("legacy").tasks;
    expect(manualTaskOrder(after).map((task) => task.id)).toEqual(
      before.map((task) => task.id),
    );
    expect(after.map((task) => task.version)).toEqual(
      before.map((task) => task.version),
    );
    expect(after.every((task) => Number.isInteger(task.sortOrder))).toBe(true);
  } finally {
    repo?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
