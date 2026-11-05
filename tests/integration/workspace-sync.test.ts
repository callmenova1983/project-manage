import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import { taskInput, type Task } from "../../packages/domain/types.js";
import type {
  Bootstrap,
  SyncVersions,
} from "../../packages/domain/workspace-sync.js";

let ctx: Awaited<ReturnType<typeof buildApp>>;
let headers: Record<string, string>;
const origin = "http://localhost:4173";
beforeEach(async () => {
  vi.stubEnv("PM_BACKGROUND_NOTIFICATIONS", "1");
  ctx = await buildApp({
    isolatedDatabase: true,
    origin,
    notificationIntervalMs: 0,
  });
  await ctx.repo.seed("sync-test");
  await createUser(ctx.repo, {
    workspaceId: "sync-test",
    email: "sync@example.test",
    name: "Sync tester",
    password: "synthetic-sync-password",
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "sync@example.test",
      password: "synthetic-sync-password",
    },
  });
  headers = {
    origin,
    cookie: `pm_session=${login.cookies[0]!.value}`,
    "x-csrf-token": login.json().csrf,
  };
});
afterEach(async () => {
  await ctx?.app.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function bootstrap() {
  const response = await ctx.app.inject({ url: "/api/bootstrap", headers });
  expect(response.statusCode).toBe(200);
  return response.json<Bootstrap>();
}
async function meta() {
  return (
    await ctx.app.inject({ url: "/api/workspace/meta", headers })
  ).json<SyncVersions>();
}
it("returns a consistent core, tiny unchanged checks and scoped operation receipts", async () => {
  const start = await bootstrap();
  expect(start.core).not.toHaveProperty("activities");
  expect(start.core).not.toHaveProperty("directory");
  expect(start.core).not.toHaveProperty("projectMembers");
  const snapshot = await ctx.repo.snapshot("sync-test");
  expect(start.core.projects).toEqual(snapshot.projects);
  expect(start.core.tasks).toEqual(snapshot.tasks);
  expect(gzipSync(JSON.stringify(start.core)).length).toBeLessThan(150000);
  const unchanged = await ctx.app.inject({
    url: `/api/workspace/core?knownVersion=${start.versions.core}`,
    headers,
  });
  expect(unchanged.json()).toEqual({
    version: start.versions.core,
    unchanged: true,
  });
  expect(Buffer.byteLength(unchanged.body)).toBeLessThan(1024);
  expect(unchanged.headers["server-timing"]).toContain("db;dur=");
  const old = start.core.tasks.find(
    (task) => !start.core.tasks.some((child) => child.parentId === task.id),
  )!;
  const key = randomUUID(),
    payload = {
      ...taskInput.strip().parse(old),
      title: old.title + " sync",
      version: old.version,
    };
  const save = () =>
    ctx.app.inject({
      method: "PUT",
      url: `/api/tasks/${old.id}`,
      headers: { ...headers, "idempotency-key": key },
      payload,
    });
  const response = await save();
  expect(response.statusCode).toBe(200);
  const saved = response.json<Task>(),
    version = (await meta()).core;
  expect(version).not.toBe(start.versions.core);
  expect((await save()).json()).toEqual(saved);
  expect((await meta()).core).toBe(version);
  await ctx.repo.audit("sync-test", {
    id: randomUUID(),
    kind: "task",
    entityId: saved.id,
    projectId: saved.projectId,
    actor: "Imported history",
    action: "Updated task",
    source: "Imported historical fixture",
    createdAt: "2020-01-01T00:00:00Z",
    before: old,
    after: { ...saved, title: "Old reused version" },
  });
  const receipts = await ctx.app.inject({
    method: "POST",
    url: "/api/activity/receipts",
    headers,
    payload: {
      entities: [{ kind: "task", id: saved.id, version: saved.version }],
    },
  });
  expect(receipts.statusCode).toBe(200);
  expect(receipts.json()[0].after.title).toBe(saved.title);
  expect(receipts.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entityId: saved.id,
        after: expect.objectContaining({ version: saved.version }),
      }),
    ]),
  );
  expect(
    (
      await ctx.app.inject({
        url: "/api/bootstrap",
        headers: { ...headers, "x-workspace-account": "another-account" },
      })
    ).statusCode,
  ).toBe(401);
});
it("rolls versions and jobs back atomically, and keeps notification GET read-only", async () => {
  const start = await bootstrap();
  await expect(
    ctx.repo.transaction(async () => {
      const project = {
        ...start.core.projects[0]!,
        name: "rollback",
        version: 100,
      };
      await ctx.repo.putProject("sync-test", project);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect((await meta()).core).toBe(start.versions.core);
  const reconcile = vi.spyOn(ctx.notifications, "reconcileWorkspace");
  const response = await ctx.app.inject({ url: "/api/notifications", headers });
  expect(response.statusCode).toBe(200);
  expect(reconcile).not.toHaveBeenCalled();
});
it("delivers only commit hints and recovers missed changes through durable versions", async () => {
  const address = await ctx.app.listen({ host: "127.0.0.1", port: 0 });
  const abort = new AbortController();
  const stream = await fetch(address + "/api/workspace/events", {
    headers: { cookie: headers.cookie! },
    signal: abort.signal,
  });
  expect(stream.headers.get("content-type")).toContain("text/event-stream");
  const reader = stream.body!.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  expect(initial).toContain("calibrate");
  const start = await bootstrap();
  await ctx.repo.transaction(() =>
    ctx.repo.putProject("sync-test", {
      ...start.core.projects[0]!,
      name: "SSE commit",
      version: 2,
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("SSE hint timed out")), 3000);
      }),
    ]);
    const hint = new TextDecoder().decode(chunk.value);
    expect(hint).toContain('"domain":"core"');
    expect(hint).not.toContain("SSE commit");
  } finally {
    clearTimeout(timer);
    abort.abort();
    await reader.cancel().catch(() => {});
  }
  await ctx.repo.transaction(() =>
    ctx.repo.putProject("sync-test", {
      ...start.core.projects[0]!,
      name: "missed while offline",
      version: 3,
    }),
  );
  const recovered = await ctx.app.inject({
    url: `/api/workspace/core?knownVersion=${start.versions.core}`,
    headers,
  });
  expect(recovered.json().core.projects[0].name).toBe("missed while offline");
});
it("retains failed jobs for lease recovery and consumes new writes without duplicate receipts", async () => {
  vi.spyOn(ctx.notifications, "wake").mockImplementation(() => {});
  await ctx.notifications.processJobs();
  await ctx.repo.transaction(() =>
    ctx.notifications.enqueueWorkspace("sync-test"),
  );
  const reconcile = vi
    .spyOn(ctx.notifications, "reconcileWorkspace")
    .mockRejectedValueOnce(new Error("worker interrupted"));
  await expect(ctx.notifications.processJobs()).rejects.toThrow(
    "worker interrupted",
  );
  expect(
    await ctx.repo.db
      .prepare("SELECT lease_token FROM notification_jobs WHERE workspace_id=?")
      .get("sync-test"),
  ).toBeTruthy();
  reconcile.mockRestore();
  await ctx.repo.transaction(async () => {
    await ctx.notifications.enqueueWorkspace("sync-test");
    await ctx.repo.db
      .prepare(
        "UPDATE notification_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id=?",
      )
      .run("sync-test");
  });
  await ctx.notifications.processJobs();
  expect(
    await ctx.repo.db
      .prepare("SELECT 1 FROM notification_jobs WHERE workspace_id=?")
      .get("sync-test"),
  ).toBeUndefined();
  const before = (await meta()).notifications;
  await ctx.notifications.processJobs();
  expect((await meta()).notifications).toBe(before);
});
