import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { emptyDirectory } from "../../packages/domain/directory";
import { type Actor, type Task } from "../../packages/domain/types";
import { createSeed } from "../../packages/domain/seed";

let ctx: Awaited<ReturnType<typeof buildApp>>,
  admin: Actor,
  worker: Actor,
  clock: Date;
const origin = "http://localhost:4173",
  password = "synthetic-notification-password";
const fetcher = vi.fn<typeof fetch>();
const sessions = new Map<string, { cookie: string; csrf: string }>();
async function login(email: string) {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  const actor = response.json().actor as Actor;
  sessions.set(actor.id, {
    cookie: `pm_session=${response.cookies[0]!.value}`,
    csrf: response.json().csrf,
  });
  return actor;
}
async function request(
  a: Actor,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) {
  const session = sessions.get(a.id)!;
  return ctx.app.inject({
    method,
    url,
    headers: {
      origin,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      "idempotency-key": randomUUID(),
    },
    payload: payload as Record<string, unknown>,
  });
}
function task(overrides: Partial<Task> = {}) {
  const p = ctx.repo.snapshot("w").projects[0]!;
  const value: Task = {
    id: randomUUID(),
    version: 1,
    updatedAt: clock.toISOString(),
    projectId: p.id,
    parentId: null,
    title: "确认现场调试",
    description: "",
    status: "todo",
    assignee: worker.name,
    assigneeId: worker.id,
    dueDate: null,
    reminderAt: new Date(clock.getTime() + 60000).toISOString(),
    workDates: [],
    workWeek: null,
    ...overrides,
  };
  ctx.repo.putTask("w", value);
  return value;
}
async function enable() {
  let result = await request(admin, "PUT", "/api/admin/notifications/config", {
    version: 0,
    enabled: true,
    corpId: "corp-test",
    agentId: 1000001,
    baseUrl: "https://pm.example.test",
    secret: "synthetic-message-secret",
  });
  expect(result.statusCode).toBe(200);
  expect(result.body).not.toContain("synthetic-message-secret");
  const synced = clock.toISOString(),
    directory = emptyDirectory();
  directory.lastSyncedAt = synced;
  directory.employees = [
    {
      id: "employee",
      name: worker.name,
      employeeNo: "N1",
      departmentIds: [],
      position: "工程师",
      email: "",
      wecomUserId: "worker.wecom",
      userId: worker.id,
      active: true,
      source: "wecom",
      wecomCorpId: "corp-test",
      wecomSeenAt: synced,
    },
  ];
  ctx.repo.db
    .prepare(
      "INSERT INTO workspace_directory(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
    )
    .run("w", JSON.stringify(directory));
  ctx.repo.db
    .prepare(
      "INSERT INTO notification_directory_scope(workspace_id,corp_id,directory_version,synced_at) VALUES('w','corp-test',1,?) ON CONFLICT(workspace_id) DO UPDATE SET synced_at=excluded.synced_at",
    )
    .run(synced);
  result = await request(admin, "POST", "/api/admin/notifications/bindings", {
    employeeIds: ["employee"],
    configVersion: 1,
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().bindings[0].confirmed).toBe(true);
  result = await request(worker, "PUT", "/api/notifications/preferences", {
    version: 1,
    delivery: "important",
    quietStart: "00:00",
    quietEnd: "00:00",
    digestTime: "09:00",
  });
  expect(result.statusCode).toBe(200);
}
beforeEach(async () => {
  sessions.clear();
  fetcher.mockReset();
  clock = new Date("2026-10-16T10:00:00Z");
  fetcher.mockImplementation(async (url) =>
    String(url).includes("gettoken")
      ? Response.json({
          access_token: "synthetic-access-token",
          expires_in: 7200,
        })
      : Response.json({ errcode: 0, msgid: "synthetic-message-id" }),
  );
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    notificationClock: () => clock,
    notificationIntervalMs: 0,
    notificationFetch: fetcher,
    wecom: {
      corpId: "corp-test",
      secret: "synthetic-contact-secret",
      workspaceId: "w",
    },
  });
  ctx.repo.workspace("w");
  await createUser(ctx.repo, {
    workspaceId: "w",
    name: "管理员",
    email: "admin@example.test",
    password,
  });
  await createUser(ctx.repo, {
    workspaceId: "w",
    name: "工程师",
    email: "worker@example.test",
    password,
  });
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='admin@example.test'")
    .run();
  admin = await login("admin@example.test");
  worker = await login("worker@example.test");
  const seed = createSeed();
  ctx.repo.putProject("w", {
    ...seed.projects[0]!,
    id: "project",
    owner: admin.name,
    ownerId: admin.id,
    stage: "implementation",
    latestUpdate: "",
  });
});
afterEach(() => ctx.app.close());
it("sends a newly due personal reminder without a browser, records acceptance separately and never replays it", async () => {
  await enable();
  const t = task();
  clock = new Date(clock.getTime() + 120000);
  await ctx.notifications.tick();
  const sends = fetcher.mock.calls.filter(([url]) =>
    String(url).includes("message/send"),
  );
  expect(sends).toHaveLength(1);
  const payload = JSON.parse(String(sends[0]![1]!.body));
  expect(payload).toMatchObject({
    touser: "worker.wecom",
    agentid: 1000001,
    msgtype: "text",
  });
  expect(payload.text.content).toContain("https://pm.example.test/messages/");
  expect(payload.text.content).not.toContain(password);
  const state = (await request(worker, "GET", "/api/notifications")).json();
  expect(
    state.items.find((item: { taskId: string }) => item.taskId === t.id),
  ).toMatchObject({ readAt: null, resolvedAt: null });
  await ctx.notifications.tick();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(1);
  expect(
    (await request(admin, "GET", "/api/admin/notifications")).json()
      .deliveries[0],
  ).toMatchObject({
    state: "accepted",
    attempts: 1,
    externalId: "synthetic-message-id",
  });
});
it("does not send when configuration or verified recipient binding is missing", async () => {
  const t = task({ reminderAt: clock.toISOString() });
  await request(worker, "PUT", "/api/notifications/preferences", {
    version: 1,
    delivery: "important",
    quietStart: "00:00",
    quietEnd: "00:00",
    digestTime: "09:00",
  });
  await ctx.notifications.tick();
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await request(worker, "GET", "/api/notifications"))
      .json()
      .items.some((item: { taskId: string }) => item.taskId === t.id),
  ).toBe(true);
  expect(
    (await request(admin, "GET", "/api/admin/notifications")).json()
      .deliveries[0].state,
  ).toBe("blocked");
});
it("cancels a reminder changed while obtaining a token before any message is submitted", async () => {
  await enable();
  const t = task();
  clock = new Date(clock.getTime() + 120000);
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("gettoken")) {
      ctx.repo.putTask("w", { ...t, version: 2, status: "done" });
      ctx.repo.transaction(() => ctx.notifications.reconcileWorkspace("w"));
      return Response.json({ access_token: "synthetic-access-token" });
    }
    return Response.json({ errcode: 0 });
  });
  await ctx.notifications.tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    (await request(admin, "GET", "/api/admin/notifications")).json()
      .deliveries[0].state,
  ).toBe("cancelled");
});
it("stops ambiguous send retries and requires explicit administrator confirmation", async () => {
  await enable();
  task();
  clock = new Date(clock.getTime() + 120000);
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("gettoken"))
      return Response.json({ access_token: "synthetic-access-token" });
    throw Error("synthetic network timeout after submit");
  });
  await ctx.notifications.tick();
  await ctx.notifications.tick();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(1);
  const row = (await request(admin, "GET", "/api/admin/notifications")).json()
    .deliveries[0];
  expect(row.state).toBe("unknown");
  expect(
    (
      await request(admin, "POST", "/api/admin/notifications/retry", {
        id: row.id,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request(worker, "POST", "/api/admin/notifications/retry", {
        id: row.id,
        confirmUnknown: true,
      })
    ).statusCode,
  ).toBe(403);
});
it("treats invaliduser as failure even with errcode zero and rejects obsolete member visibility", async () => {
  await enable();
  task();
  clock = new Date(clock.getTime() + 120000);
  fetcher.mockImplementation(async (url) =>
    String(url).includes("gettoken")
      ? Response.json({ access_token: "synthetic-access-token" })
      : Response.json({ errcode: 0, invaliduser: "worker.wecom" }),
  );
  await ctx.notifications.tick();
  expect(
    (await request(admin, "GET", "/api/admin/notifications")).json()
      .deliveries[0],
  ).toMatchObject({ state: "failed" });
  const newScope = new Date(clock.getTime() + 1000).toISOString();
  ctx.repo.db
    .prepare(
      "UPDATE notification_directory_scope SET synced_at=? WHERE workspace_id='w'",
    )
    .run(newScope);
  task({ reminderAt: clock.toISOString() });
  await ctx.notifications.tick();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(1);
  expect(
    (await request(worker, "GET", "/api/notifications")).json().deliveryStatus
      .bound,
  ).toBe(false);
});
it("keeps a reminder scheduled when it is snoozed during token retrieval", async () => {
  await enable();
  const t = task();
  clock = new Date(clock.getTime() + 120000);
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("gettoken")) {
      const state = (await request(worker, "GET", "/api/notifications")).json();
      const item = state.items.find(
        (value: { taskId: string }) => value.taskId === t.id,
      );
      const response = await request(
        worker,
        "POST",
        "/api/notifications/action",
        {
          ids: [item.id],
          action: "snooze",
          until: new Date(clock.getTime() + 3600000).toISOString(),
        },
      );
      expect(response.statusCode).toBe(200);
      return Response.json({ access_token: "synthetic-access-token" });
    }
    return Response.json({ errcode: 0, msgid: "later-message" });
  });
  await ctx.notifications.tick();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(0);
  expect(
    (await request(admin, "GET", "/api/admin/notifications"))
      .json()
      .deliveries.some((row: { state: string }) => row.state === "pending"),
  ).toBe(true);
  clock = new Date(clock.getTime() + 3600001);
  await ctx.notifications.tick();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(1);
});
it("waits through quiet hours and sends one summary at the configured local digest time", async () => {
  await enable();
  await request(worker, "PUT", "/api/notifications/preferences", {
    version: 2,
    delivery: "digest",
    quietStart: "21:00",
    quietEnd: "08:00",
    digestTime: "09:00",
  });
  task();
  task();
  clock = new Date(clock.getTime() + 120000);
  await ctx.notifications.tick();
  expect(fetcher).not.toHaveBeenCalled();
  clock = new Date("2026-10-17T07:00:00Z");
  await ctx.notifications.tick();
  expect(fetcher).not.toHaveBeenCalled();
  clock = new Date("2026-10-17T09:00:01Z");
  await ctx.notifications.tick();
  const sends = fetcher.mock.calls.filter(([url]) =>
    String(url).includes("message/send"),
  );
  expect(sends).toHaveLength(1);
  const payload = JSON.parse(String(sends[0]![1]!.body));
  expect(
    payload.text.content.match(/https:\/\/pm.example.test\/messages\//g),
  ).toHaveLength(2);
});
it("creates one new personal occurrence for snooze after an accepted and read reminder", async () => {
  await enable();
  const t = task();
  clock = new Date(clock.getTime() + 120000);
  await ctx.notifications.tick();
  let state = (await request(worker, "GET", "/api/notifications")).json();
  const item = state.items.find(
    (value: { taskId: string }) => value.taskId === t.id,
  );
  await request(worker, "POST", "/api/notifications/action", {
    ids: [item.id],
    action: "read",
  });
  const before = ctx.repo.snapshot("w");
  state = (
    await request(worker, "POST", "/api/notifications/action", {
      ids: [item.id],
      action: "snooze",
      until: new Date(clock.getTime() + 3600000).toISOString(),
    })
  ).json();
  expect(state.unreadCount).toBe(0);
  expect(ctx.repo.snapshot("w")).toEqual(before);
  clock = new Date(clock.getTime() + 3600001);
  await ctx.notifications.tick();
  await ctx.notifications.tick();
  state = (await request(worker, "GET", "/api/notifications")).json();
  expect(state.unreadCount).toBe(1);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(2);
});
it("resumes current blocked deliveries after administrator verifies the recipient", async () => {
  await enable();
  ctx.repo.db
    .prepare("DELETE FROM notification_bindings WHERE workspace_id='w'")
    .run();
  task();
  clock = new Date(clock.getTime() + 120000);
  await ctx.notifications.tick();
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await request(admin, "GET", "/api/admin/notifications")).json()
      .deliveries[0].state,
  ).toBe("blocked");
  expect(
    (
      await request(admin, "POST", "/api/admin/notifications/bindings", {
        employeeIds: ["employee"],
        configVersion: 1,
      })
    ).statusCode,
  ).toBe(200);
  await ctx.notifications.tick();
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("message/send")),
  ).toHaveLength(1);
});
