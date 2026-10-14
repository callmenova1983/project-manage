import { beforeEach, afterEach, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import type { Activity, Snapshot } from "../../packages/domain/types";
import type { ActivityPage } from "../../packages/domain/activity-query";
let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173";
beforeEach(async () => {
  ctx = await buildApp({ databasePath: ":memory:", origin });
  ctx.repo.seed("team");
  const password = randomBytes(24).toString("hex");
  await createUser(ctx.repo, {
    email: "admin@example.test",
    name: "Synthetic admin",
    workspaceId: "team",
    password,
  });
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE workspace_id=?")
    .run("team");
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "admin@example.test", password },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(async () => {
  await ctx.app.close();
});
function request(
  method: "GET" | "PUT" | "POST",
  url: string,
  payload?: unknown,
) {
  return ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
  });
}
const save = (timeZone: string, version = 1) =>
  request("PUT", "/api/admin/workspace-settings", {
    timeZone,
    version,
    confirmed: true,
  });
it("defaults to UTC, requires admin and confirmation, version checks and preserves data", async () => {
  const before = ctx.repo.snapshot("team");
  expect(before.settings).toEqual({ timeZone: "UTC", version: 1 });
  expect(
    (
      await request("PUT", "/api/admin/workspace-settings", {
        timeZone: "Asia/Shanghai",
        version: 1,
      })
    ).statusCode,
  ).toBe(400);
  expect((await save("+08:00")).statusCode).toBe(400);
  expect((await save("Asia/Shanghai")).json()).toEqual({
    timeZone: "Asia/Shanghai",
    version: 2,
  });
  expect((await save("UTC")).statusCode).toBe(409);
  const after = (await request("GET", "/api/workspace")).json<Snapshot>();
  expect(after.projects).toEqual(before.projects);
  expect(after.tasks).toEqual(before.tasks);
  expect(after.activities).toEqual(before.activities);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(
    JSON.stringify(ctx.repo.db.prepare("SELECT * FROM admin_audit").all()),
  ).toContain("Asia/Shanghai");
  ctx.repo.db
    .prepare("UPDATE users SET role='member' WHERE workspace_id=?")
    .run("team");
  expect((await save("UTC", 2)).statusCode).toBe(403);
  expect(
    (await request("GET", "/api/workspace")).json().settings.timeZone,
  ).toBe("Asia/Shanghai");
});
it("uses Shanghai boundaries consistently across SQL totals, pages and a frozen filtered export", async () => {
  const times = [
    "2020-10-04T15:59:59.999Z",
    "2020-10-04T16:00:00Z",
    "2020-10-05T00:00:00+08:00",
    "2020-10-11T15:59:59.999Z",
    "2020-10-11T16:00:00Z",
  ];
  const make = (id: string, createdAt: string): Activity => ({
    id,
    createdAt,
    projectId: "project-1",
    entityId: "project-1",
    kind: "project",
    action: "Updated project",
    actor: "Synthetic",
    source: "boundary fixture",
    before: null,
    after: null,
  });
  times.forEach((at, i) => ctx.repo.audit("team", make(`event-${i}`, at)));
  const query = {
    weekStart: "2020-10-05",
    search: "boundary fixture",
    limit: 1,
  };
  const utc = (
    await request("POST", "/api/activity/query", query)
  ).json<ActivityPage>();
  expect(utc.total).toBe(2);
  await save("Asia/Shanghai");
  expect(
    (
      await request("POST", "/api/activity/query", {
        ...query,
        cursor: utc.nextCursor,
      })
    ).statusCode,
  ).toBe(400);
  const first = (
    await request("POST", "/api/activity/query", {
      ...query,
      timeZone: "Asia/Shanghai",
    })
  ).json<ActivityPage>();
  expect(first.total).toBe(3);
  expect(first.days.map((d) => d.count)).toEqual([2, 0, 0, 0, 0, 0, 1]);
  expect(first.bounds).toEqual({
    start: "2020-10-04T16:00:00.000Z",
    end: "2020-10-11T16:00:00.000Z",
  });
  ctx.repo.audit("team", make("late", "2020-10-06T00:00:00Z"));
  const ids = first.events.map((a) => a.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const next = (
      await request("POST", "/api/activity/query", { ...query, cursor })
    ).json<ActivityPage>();
    expect(next.total).toBe(3);
    ids.push(...next.events.map((a) => a.id));
    cursor = next.nextCursor;
  }
  const exported = (
    await request("POST", "/api/activity/export", {
      ...query,
      checkpoint: first.checkpoint,
    })
  ).json<ActivityPage>();
  expect(exported.events.map((a) => a.id)).toEqual(ids);
  expect(exported.days).toEqual(first.days);
  expect(exported.checkpoint).toEqual(first.checkpoint);
  expect(exported.nextCursor).toBeNull();
  expect(
    (
      await request("POST", "/api/activity/export", {
        ...query,
        search: "changed",
        checkpoint: first.checkpoint,
      })
    ).statusCode,
  ).toBe(400);
  await save("America/New_York", 2);
  expect(
    (
      await request("POST", "/api/activity/export", {
        ...query,
        timeZone: "Asia/Shanghai",
        checkpoint: first.checkpoint,
      })
    ).statusCode,
  ).toBe(409);
});
it("includes timezone metadata in workspace exports and preserves the destination timezone on import", async () => {
  await save("Asia/Shanghai");
  const exported = (await request("GET", "/api/export")).json<Snapshot>();
  expect(exported.settings).toEqual({ timeZone: "Asia/Shanghai", version: 2 });
  const result = await request("POST", "/api/import", {
    ...exported,
    settings: { timeZone: "America/New_York", version: 19 },
    confirmed: true,
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(ctx.repo.settings("team")).toEqual({
    timeZone: "Asia/Shanghai",
    version: 2,
  });
});
