import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import type { Task } from "../../packages/domain/types";
let context: Awaited<ReturnType<typeof buildApp>>,
  tasks: Task[],
  cookie: string,
  csrf: string;
const origin = "http://localhost:4173";
const request = (body: unknown, key = randomUUID()) =>
  context.app.inject({
    method: "POST",
    url: "/api/tasks/copy-field",
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
    payload: body as Record<string, unknown>,
  });
const input = () => ({
  sourceId: tasks[0]!.id,
  sourceVersion: tasks[0]!.version,
  field: "assignee",
  targets: tasks
    .slice(1, 3)
    .map((task) => ({ id: task.id, version: task.version })),
  overwriteConfirmed: false,
});
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("team");
  await createUser(context.repo, {
    email: "member@example.test",
    name: "Member",
    workspaceId: "team",
    password: "synthetic-copy-test-password",
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "member@example.test",
      password: "synthetic-copy-test-password",
    },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
  const all = context.repo.snapshot("team").tasks;
  tasks = all
    .filter((task) => task.projectId === all[0]!.projectId)
    .slice(0, 3)
    .map((task, index) => ({
      ...task,
      assignee: index === 0 ? "Copy source" : "",
      dueDate: index === 0 ? "2026-10-20" : null,
    }));
  for (const task of tasks) context.repo.putTask("team", task);
});
afterEach(() => context.app.close());
it("copies only the chosen field to several rows and replays without duplicating audit records", async () => {
  const key = randomUUID(),
    body = input();
  const first = await request(body, key);
  expect(first.statusCode).toBe(200);
  const snapshot = context.repo.snapshot("team");
  for (const before of tasks.slice(1, 3)) {
    expect(snapshot.tasks.find((task) => task.id === before.id)).toEqual({
      ...before,
      assignee: "Copy source",
      version: before.version + 1,
      updatedAt: expect.any(String),
    });
  }
  const replay = await request(body, key);
  expect(replay.json()).toEqual(first.json());
  expect(context.repo.snapshot("team").revision).toBe(snapshot.revision);
});
it("requires explicit overwrite consent and leaves all targets untouched when any is stale", async () => {
  context.repo.putTask("team", { ...tasks[2]!, assignee: "Existing owner" });
  const before = context.repo.snapshot("team");
  expect((await request(input())).statusCode).toBe(400);
  expect(context.repo.snapshot("team")).toEqual(before);
  expect(
    (
      await request({
        ...input(),
        overwriteConfirmed: true,
        targets: [
          { id: tasks[1]!.id, version: tasks[1]!.version },
          { id: tasks[2]!.id, version: 999 },
        ],
      })
    ).statusCode,
  ).toBe(409);
  expect(context.repo.snapshot("team")).toEqual(before);
  expect(
    (await request({ ...input(), overwriteConfirmed: true })).statusCode,
  ).toBe(200);
});
it("copies dates, rejects stale source and tasks in other projects or workspaces", async () => {
  expect((await request({ ...input(), sourceVersion: 999 })).statusCode).toBe(
    409,
  );
  const other = context.repo
    .snapshot("team")
    .tasks.find((task) => task.projectId !== tasks[0]!.projectId)!;
  expect(
    (
      await request({
        ...input(),
        targets: [{ id: other.id, version: other.version }],
      })
    ).statusCode,
  ).toBe(409);
  context.repo.seed("other");
  const foreign = { ...tasks[1]!, id: "foreign-task" };
  context.repo.putTask("other", foreign);
  expect(
    (
      await request({
        ...input(),
        targets: [{ id: foreign.id, version: foreign.version }],
      })
    ).statusCode,
  ).toBe(409);
  expect((await request({ ...input(), field: "dueDate" })).statusCode).toBe(
    200,
  );
  for (const target of tasks.slice(1, 3)) {
    const after = context.repo.get<Task>("tasks", "team", target.id);
    expect(after.dueDate).toBe("2026-10-20");
    expect(after.assignee).toBe("");
  }
});
