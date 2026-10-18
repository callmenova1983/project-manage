import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { statistics, taskInput, type Task } from "../../packages/domain/types";
let context: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173";
const post = (url: string, payload: unknown, key = randomUUID()) =>
  context.app.inject({
    method: "POST",
    url,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
    payload: payload as Record<string, unknown>,
  });
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("team");
  await createUser(context.repo, {
    name: "Member",
    email: "member@example.test",
    workspaceId: "team",
    password: "synthetic-lifecycle-password",
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "member@example.test",
      password: "synthetic-lifecycle-password",
    },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(() => context.app.close());
it("voids a task tree without deleting data, excludes it from work totals, and restores the batch with audit and replay protection", async () => {
  const snapshot = context.repo.snapshot("team"),
    root = snapshot.tasks.find((t) =>
      snapshot.tasks.some((c) => c.parentId === t.id),
    )!;
  const total = statistics(snapshot.tasks).total,
    key = randomUUID();
  const input = {
    version: root.version,
    revision: snapshot.revision,
    action: "void",
    reason: "误录的任务",
  };
  const response = await post(`/api/tasks/${root.id}/lifecycle`, input, key);
  expect(response.statusCode).toBe(200);
  const changed = response.json<Task[]>();
  expect(changed.length).toBeGreaterThan(1);
  const after = context.repo.snapshot("team");
  expect(after.tasks).toHaveLength(snapshot.tasks.length);
  for (const task of changed) {
    const before = snapshot.tasks.find((t) => t.id === task.id)!;
    expect(task).toMatchObject({
      ...before,
      version: before.version + 1,
      updatedAt: expect.any(String),
      voided: { actor: "Member", reason: "误录的任务", at: expect.any(String) },
    });
    expect(
      after.activities.some(
        (a) =>
          a.entityId === task.id &&
          a.action === "作废任务" &&
          a.before?.version === before.version,
      ),
    ).toBe(true);
  }
  expect(statistics(after.tasks).total).toBeLessThan(total);
  const replay = await post(`/api/tasks/${root.id}/lifecycle`, input, key);
  expect(replay.json()).toEqual(changed);
  expect(context.repo.snapshot("team").revision).toBe(after.revision);
  // Ordinary edits cannot silently resurrect a voided task or erase the audit marker.
  const update = await context.app.inject({
    method: "PUT",
    url: `/api/tasks/${root.id}`,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: { ...taskInput.strip().parse(root), version: root.version + 1 },
  });
  expect(update.statusCode).toBe(400);
  const restored = await post(`/api/tasks/${root.id}/lifecycle`, {
    version: root.version + 1,
    revision: after.revision,
    action: "restore",
    reason: "",
  });
  expect(restored.statusCode).toBe(200);
  expect(restored.json<Task[]>()).toHaveLength(changed.length);
  const final = context.repo.snapshot("team");
  expect(statistics(final.tasks).total).toBe(total);
  expect(final.tasks.every((t) => !t.voided)).toBe(true);
  expect(
    final.activities.some(
      (a) => a.entityId === root.id && a.action === "作废任务",
    ),
  ).toBe(true);
  expect(
    final.activities.some(
      (a) => a.entityId === root.id && a.action === "恢复已作废任务",
    ),
  ).toBe(true);
});
it("rejects empty reasons and stale or foreign targets without any partial writes", async () => {
  const before = context.repo.snapshot("team"),
    root = before.tasks[0]!;
  const input = {
    version: root.version,
    revision: before.revision,
    action: "void",
    reason: "误录",
  };
  for (const payload of [
    { ...input, reason: "" },
    { ...input, version: 999 },
    { ...input, revision: 999 },
  ])
    expect(
      (await post(`/api/tasks/${root.id}/lifecycle`, payload)).statusCode,
    ).toBeGreaterThanOrEqual(400);
  context.repo.seed("foreign");
  context.repo.putTask("foreign", { ...root, id: "foreign-task" });
  expect(
    (await post("/api/tasks/foreign-task/lifecycle", input)).statusCode,
  ).toBe(409);
  expect(context.repo.snapshot("team")).toEqual(before);
});
