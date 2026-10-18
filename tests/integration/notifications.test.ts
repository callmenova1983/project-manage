import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import {
  defaultNotificationPreferences,
  notificationResponseSchema,
  type NotificationResponse,
} from "../../packages/domain/notifications.js";
import {
  taskInput,
  type Actor,
  type Project,
  type Task,
  type TaskInput,
} from "../../packages/domain/types.js";

const origin = "http://localhost:4173";
const password = "synthetic-notification-password";
type Session = { cookie: string; csrf: string; email: string };
let ctx: Awaited<ReturnType<typeof buildApp>>;
let clock: Date;
let folders: string[];
let actors: Record<"editor" | "recipient" | "namesake" | "foreign", Actor>;
const fetcher = vi.fn<typeof fetch>();

const options = (databasePath = ":memory:") => ({
  databasePath,
  origin,
  notificationClock: () => new Date(clock),
  notificationIntervalMs: 0,
  notificationFetch: fetcher,
});
function project(id = "p", patch: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    owner: actors.editor.name,
    ownerId: actors.editor.id,
    client: "",
    description: "",
    stage: "implementation",
    discipline: "Engineering",
    latestUpdate: "",
    notes: "",
    aliases: [],
    reportedAt: null,
    reportedBy: null,
    version: 1,
    updatedAt: clock.toISOString(),
    ...patch,
  };
}
function input(patch: Partial<TaskInput> = {}): TaskInput {
  return {
    projectId: "p",
    parentId: null,
    title: "核对设备状态",
    description: "",
    status: "todo",
    assignee: actors.recipient.name,
    assigneeId: actors.recipient.id,
    dueDate: null,
    estimatedDate: null,
    reminderAt: null,
    workWeek: null,
    workDates: [],
    ...patch,
  };
}
function putTask(id: string, patch: Partial<TaskInput> = {}): Task {
  const task: Task = {
    ...input(patch),
    id,
    version: 1,
    updatedAt: clock.toISOString(),
  };
  ctx.repo.putTask("team", task);
  return task;
}
async function setup(databasePath = ":memory:") {
  ctx = await buildApp(options(databasePath));
  const specs = [
    ["editor", "录入者", "team"],
    ["recipient", "王敏", "team"],
    ["namesake", "王敏", "team"],
    ["foreign", "其他工作区", "outside"],
  ] as const;
  actors = {} as typeof actors;
  for (const [key, name, workspaceId] of specs) {
    const email = `${key}@example.test`;
    await createUser(ctx.repo, { name, email, password, workspaceId });
    const row = ctx.repo.db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(email)!;
    actors[key] = {
      id: String(row.id),
      name,
      email,
      workspaceId,
      role: "member",
    };
  }
  ctx.repo.putProject("team", project());
  ctx.repo.putProject("team", project("q"));
  ctx.repo.putProject(
    "outside",
    project("outside-project", {
      owner: actors.foreign.name,
      ownerId: actors.foreign.id,
    }),
  );
}
async function login(key: keyof typeof actors = "editor"): Promise<Session> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: actors[key].email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: `pm_session=${response.cookies[0]!.value}`,
    csrf: response.json().csrf as string,
    email: actors[key].email,
  };
}
function request(
  session: Session,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) {
  return ctx.app.inject({
    method,
    url,
    headers: {
      origin,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      "idempotency-key": key,
    },
    payload: payload as Record<string, unknown>,
  });
}
async function state(session: Session): Promise<NotificationResponse> {
  const response = await request(session, "GET", "/api/notifications");
  expect(response.statusCode, response.body).toBe(200);
  return notificationResponseSchema.parse(response.json());
}
async function update(session: Session, id: string, patch: Partial<TaskInput>) {
  const task = ctx.repo.get<Task>("tasks", "team", id);
  const response = await request(session, "PUT", `/api/tasks/${id}`, {
    ...taskInput.strip().parse(task),
    ...patch,
    version: task.version,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Task>();
}

beforeEach(async () => {
  clock = new Date("2026-10-16T10:00:00Z");
  folders = [];
  fetcher.mockReset();
  await setup();
});
afterEach(async () => {
  await ctx.app.close();
  for (const folder of folders)
    rmSync(folder, { recursive: true, force: true });
});

describe("account notification inbox", () => {
  it("initializes current risks without replaying historical assignments or external deliveries", async () => {
    const historical = putTask("historical", {
      dueDate: "2026-10-15",
      status: "blocked",
      reminderAt: "2026-10-16T09:00:00Z",
    });
    ctx.repo.record(actors.editor, "task", "Created task", null, historical);
    const recipient = await login("recipient");
    const before = await state(recipient);
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toMatchObject({
      key: "task:historical",
      tags: ["overdue", "coordination", "reminder"],
      actionable: true,
    });
    expect(before.items.some((item) => item.kind === "assignment")).toBe(false);
    expect(
      ctx.repo.db
        .prepare("SELECT COUNT(*) AS n FROM notification_outbox")
        .get()!.n,
    ).toBe(0);
    await ctx.notifications.tick();
    expect((await state(recipient)).items.map((item) => item.id)).toEqual(
      before.items.map((item) => item.id),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses explicit recipient IDs, isolates workspaces, and protects open/read endpoints", async () => {
    putTask("mine", { status: "blocked" });
    putTask("namesake", { status: "blocked", assigneeId: actors.namesake.id });
    putTask("text-only", { status: "blocked", assigneeId: null });
    const recipient = await login("recipient");
    const mine = await state(recipient);
    expect(mine.items.map((item) => item.taskId)).toEqual(["mine"]);
    const owner = await state(await login());
    expect(
      owner.items
        .filter((item) => item.kind === "task_risk")
        .map((item) => item.taskId),
    ).toEqual(["text-only"]);
    const sameName = await state(await login("namesake"));
    expect(sameName.items.map((item) => item.taskId)).toEqual(["namesake"]);
    const foreign = await login("foreign");
    expect((await state(foreign)).items).toEqual([]);
    expect(
      (
        await request(
          foreign,
          "GET",
          `/api/notifications/${mine.items[0]!.id}/open`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(foreign, "POST", "/api/notifications/action", {
          ids: [mine.items[0]!.id],
          action: "read",
        })
      ).statusCode,
    ).toBe(404);
    expect((await state(recipient)).items[0]!.readAt).toBeNull();
    expect((await ctx.app.inject("/api/notifications")).statusCode).toBe(401);
  });

  it.each(["reschedule", "complete", "void"] as const)(
    "closes obsolete task risks after %s without removing their history",
    async (change) => {
      putTask("risk", {
        dueDate: "2026-10-15",
        status: "blocked",
        reminderAt: "2026-10-16T09:00:00Z",
      });
      const editor = await login();
      const recipient = await login("recipient");
      const initial = await state(recipient);
      const id = initial.items[0]!.id;
      if (change === "reschedule")
        await update(editor, "risk", {
          dueDate: "2026-11-01",
          status: "todo",
          reminderAt: "2026-11-01T09:00:00Z",
        });
      else if (change === "complete")
        await update(editor, "risk", { status: "done" });
      else {
        const snapshot = ctx.repo.snapshot("team");
        const response = await request(
          editor,
          "POST",
          "/api/tasks/risk/lifecycle",
          {
            version: snapshot.tasks[0]!.version,
            revision: snapshot.revision,
            action: "void",
            reason: "误录，留存原始记录",
          },
        );
        expect(response.statusCode, response.body).toBe(200);
      }
      const after = await state(recipient);
      expect(after.pendingCount).toBe(0);
      expect(
        after.items.find((item) => item.id === id)?.resolvedAt,
      ).toBeTruthy();
      expect(ctx.repo.get<Task>("tasks", "team", "risk")).toBeDefined();
      expect(ctx.repo.snapshot("team").activities).toHaveLength(1);
    },
  );

  it("keeps reading and snoozing independent from business completion and dates", async () => {
    putTask("risk", { status: "blocked", dueDate: "2026-10-15" });
    const recipient = await login("recipient");
    const initial = await state(recipient);
    const beforeTask = ctx.repo.get<Task>("tasks", "team", "risk");
    const beforeRevision = ctx.repo.snapshot("team").revision;
    const read = await request(recipient, "POST", "/api/notifications/action", {
      ids: [initial.items[0]!.id],
      action: "read",
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({ unreadCount: 0, pendingCount: 1 });
    expect(read.json<NotificationResponse>().items[0]!.resolvedAt).toBeNull();
    const until = "2026-10-16T11:00:00Z";
    const snoozed = await request(
      recipient,
      "POST",
      "/api/notifications/action",
      {
        ids: [initial.items[0]!.id],
        action: "snooze",
        until,
      },
    );
    expect(snoozed.statusCode, snoozed.body).toBe(200);
    expect((await state(recipient)).items[0]!.snoozedUntil).toBe(
      new Date(until).toISOString(),
    );
    expect(ctx.repo.get<Task>("tasks", "team", "risk")).toEqual(beforeTask);
    expect(ctx.repo.snapshot("team").revision).toBe(beforeRevision);
    const unread = await request(
      recipient,
      "POST",
      "/api/notifications/action",
      { ids: [initial.items[0]!.id], action: "unread" },
    );
    expect(unread.statusCode).toBe(200);
    expect((await state(recipient)).unreadCount).toBe(0);
    clock = new Date(until);
    expect((await state(recipient)).unreadCount).toBe(1);
    expect((await state(recipient)).pendingCount).toBe(1);
  });

  it("validates snooze offsets as instants and normalizes the persisted time", async () => {
    putTask("risk", { status: "blocked" });
    const recipient = await login("recipient");
    const id = (await state(recipient)).items[0]!.id;
    const past = await request(recipient, "POST", "/api/notifications/action", {
      ids: [id],
      action: "snooze",
      until: "2026-10-16T17:00:00+08:00",
    });
    expect(past.statusCode, past.body).toBe(400);
    const future = await request(
      recipient,
      "POST",
      "/api/notifications/action",
      { ids: [id], action: "snooze", until: "2026-10-16T19:00:00+08:00" },
    );
    expect(future.statusCode, future.body).toBe(200);
    expect(Date.parse((await state(recipient)).items[0]!.snoozedUntil!)).toBe(
      Date.parse("2026-10-16T11:00:00Z"),
    );
  });

  it("persists account settings, following and read state across server restart", async () => {
    await ctx.app.close();
    const folder = mkdtempSync(join(tmpdir(), "pm-notification-inbox-"));
    folders.push(folder);
    const databasePath = join(folder, "db.sqlite");
    await setup(databasePath);
    putTask("risk", { status: "blocked" });
    let recipient = await login("recipient");
    const item = (await state(recipient)).items[0]!;
    const preferences = {
      ...defaultNotificationPreferences,
      delivery: "digest",
      digestTime: "10:30",
      quietStart: "23:00",
    };
    expect(
      (
        await request(
          recipient,
          "PUT",
          "/api/notifications/preferences",
          preferences,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          recipient,
          "PUT",
          "/api/notifications/preferences",
          preferences,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/following", {
          mode: "replace",
          projectIds: ["p"],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/following", {
          mode: "merge",
          projectIds: ["p", "q"],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(recipient, "POST", "/api/notifications/action", {
          ids: [item.id],
          action: "read",
        })
      ).statusCode,
    ).toBe(200);
    const expected = await state(recipient);
    await ctx.app.close();
    ctx = await buildApp(options(databasePath));
    recipient = await login("recipient");
    const after = await state(recipient);
    expect(after.preferences).toEqual({ ...preferences, version: 2 });
    expect(after.followingIds).toEqual(["p", "q"]);
    expect(after.items).toEqual(expected.items);
    expect(after.unreadCount).toBe(0);
    expect(after.pendingCount).toBe(1);
    const other = await state(await login("namesake"));
    expect(other.preferences).toEqual(defaultNotificationPreferences);
    expect(other.followingIds).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("records a new assignment once, suppresses self notifications and never fetches an unconfigured channel", async () => {
    const editor = await login();
    const recipient = await login("recipient");
    const configured = await request(
      recipient,
      "PUT",
      "/api/notifications/preferences",
      { ...defaultNotificationPreferences, delivery: "important" },
    );
    expect(configured.statusCode).toBe(200);
    expect(
      configured.json<NotificationResponse>().deliveryStatus,
    ).toMatchObject({ configured: false, bound: false });
    const key = randomUUID();
    const created = await request(editor, "POST", "/api/tasks", input(), key);
    expect(created.statusCode, created.body).toBe(200);
    expect(
      (await request(editor, "POST", "/api/tasks", input(), key)).json(),
    ).toEqual(created.json());
    await ctx.notifications.tick();
    await ctx.notifications.tick();
    expect(
      (await state(recipient)).items.filter(
        (item) => item.kind === "assignment",
      ),
    ).toHaveLength(1);
    expect(
      ctx.repo.db
        .prepare("SELECT COUNT(*) AS n FROM notification_outbox")
        .get()!.n,
    ).toBe(1);
    const self = await request(
      editor,
      "POST",
      "/api/tasks",
      input({
        assigneeId: actors.editor.id,
        assignee: actors.editor.name,
        title: "本人分配",
      }),
    );
    expect(self.statusCode).toBe(200);
    expect(
      (await state(editor)).items.filter((item) => item.kind === "assignment"),
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("opens old task and project notifications at their retained destination after a project merge", async () => {
    const editor = await login();
    const recipient = await login("recipient");
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/following", {
          projectIds: ["p"],
          mode: "replace",
        })
      ).statusCode,
    ).toBe(200);
    const created = await request(editor, "POST", "/api/tasks", input());
    const task = created.json<Task>();
    const progress = await request(editor, "POST", "/api/projects/p/progress", {
      version: 1,
      mode: "new",
      text: "现场设备已到货",
    });
    expect(progress.statusCode, progress.body).toBe(200);
    const prior = await state(recipient);
    const assignment = prior.items.find((item) => item.kind === "assignment")!;
    const projectUpdate = prior.items.find(
      (item) => item.kind === "project_update",
    )!;
    expect(assignment).toBeDefined();
    expect(projectUpdate).toBeDefined();
    const merged = await request(editor, "POST", "/api/projects/merge", {
      targetId: "q",
      sourceIds: ["p"],
      name: "保留项目",
      revision: ctx.repo.snapshot("team").revision,
      confirmed: true,
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect(
      (
        await request(
          recipient,
          "GET",
          `/api/notifications/${assignment.id}/open`,
        )
      ).json(),
    ).toEqual({ path: `/projects/q?task=${encodeURIComponent(task.id)}` });
    expect(
      (
        await request(
          recipient,
          "GET",
          `/api/notifications/${projectUpdate.id}/open`,
        )
      ).json(),
    ).toEqual({ path: "/projects/q#progress-history" });
    expect(
      (await state(recipient)).items.filter(
        (item) => item.kind === "assignment",
      ),
    ).toHaveLength(1);
  });

  it("restores current risk visibility without replaying old external reminders", async () => {
    putTask("risk", { dueDate: "2026-10-15" });
    const editor = await login();
    const recipient = await login("recipient");
    const initial = (await state(recipient)).items[0]!;
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/preferences", {
          ...defaultNotificationPreferences,
          delivery: "important",
        })
      ).statusCode,
    ).toBe(200);
    await update(editor, "risk", { status: "done" });
    const event = ctx.repo
      .snapshot("team")
      .activities.find((value) => value.entityId === "risk")!;
    const restore = await request(
      editor,
      "POST",
      `/api/activities/${event.id}/restore`,
      { version: ctx.repo.get<Task>("tasks", "team", "risk").version },
    );
    expect(restore.statusCode, restore.body).toBe(200);
    const after = await state(recipient);
    expect(
      after.items.find((item) => item.id === initial.id)?.resolvedAt,
    ).toBeNull();
    expect(after.pendingCount).toBe(1);
    expect(
      ctx.repo.db
        .prepare("SELECT COUNT(*) AS n FROM notification_outbox")
        .get()!.n,
    ).toBe(0);
    await ctx.notifications.tick();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels pending external delivery when an account is disabled", async () => {
    const editor = await login();
    const recipient = await login("recipient");
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/preferences", {
          ...defaultNotificationPreferences,
          delivery: "important",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await request(editor, "POST", "/api/tasks", input())).statusCode,
    ).toBe(200);
    expect(
      ctx.repo.db.prepare("SELECT state FROM notification_outbox").get()!.state,
    ).toBe("pending");
    ctx.repo.db
      .prepare("UPDATE users SET status='disabled' WHERE id=?")
      .run(actors.recipient.id);
    await ctx.notifications.tick();
    expect(
      ctx.repo.db.prepare("SELECT state FROM notification_outbox").get()!.state,
    ).toBe("cancelled");
    expect(
      (await request(recipient, "GET", "/api/notifications")).statusCode,
    ).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("materializes an exact-time reminder once and cancels its queued delivery after completion", async () => {
    putTask("scheduled", { reminderAt: "2026-10-16T11:00:00Z" });
    const editor = await login();
    const recipient = await login("recipient");
    expect((await state(recipient)).items).toEqual([]);
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/preferences", {
          ...defaultNotificationPreferences,
          delivery: "important",
        })
      ).statusCode,
    ).toBe(200);
    clock = new Date("2026-10-16T10:59:59.999Z");
    await ctx.notifications.tick();
    expect((await state(recipient)).items).toEqual([]);
    clock = new Date("2026-10-16T11:00:00Z");
    await ctx.notifications.tick();
    await ctx.notifications.tick();
    const after = await state(recipient);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({
      key: "task:scheduled",
      tags: ["reminder"],
    });
    expect(
      ctx.repo.db
        .prepare("SELECT COUNT(*) AS n FROM notification_outbox")
        .get()!.n,
    ).toBe(1);
    expect(
      ctx.repo.db.prepare("SELECT state FROM notification_outbox").get()!.state,
    ).toBe("blocked");
    await update(editor, "scheduled", { status: "done" });
    expect((await state(recipient)).pendingCount).toBe(0);
    expect(
      ctx.repo.db.prepare("SELECT state FROM notification_outbox").get()!.state,
    ).toBe("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("restores backup risk visibility without replaying imported assignment or external events", async () => {
    putTask("backup-risk", { dueDate: "2026-10-15" });
    const editor = await login();
    const recipient = await login("recipient");
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/preferences", {
          ...defaultNotificationPreferences,
          delivery: "important",
        })
      ).statusCode,
    ).toBe(200);
    const saved = (await request(editor, "GET", "/api/export")).json();
    await update(editor, "backup-risk", { status: "done" });
    expect((await state(recipient)).pendingCount).toBe(0);
    const imported = await request(editor, "POST", "/api/import", {
      ...saved,
      revision: ctx.repo.snapshot("team").revision,
      confirmed: true,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    await ctx.notifications.tick();
    const after = await state(recipient);
    expect(after.pendingCount).toBe(1);
    expect(after.items.filter((item) => item.kind === "assignment")).toEqual(
      [],
    );
    expect(
      ctx.repo.db
        .prepare("SELECT COUNT(*) AS n FROM notification_outbox")
        .get()!.n,
    ).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rolls back a multi-item snooze when one item is already resolved and rejects foreign following", async () => {
    putTask("open", { status: "blocked" });
    putTask("closed", { status: "blocked" });
    const editor = await login();
    const recipient = await login("recipient");
    const before = await state(recipient);
    const open = before.items.find((item) => item.taskId === "open")!;
    const closed = before.items.find((item) => item.taskId === "closed")!;
    await update(editor, "closed", { status: "done" });
    const failed = await request(
      recipient,
      "POST",
      "/api/notifications/action",
      {
        ids: [open.id, closed.id],
        action: "snooze",
        until: "2026-10-16T11:00:00Z",
      },
    );
    expect(failed.statusCode, failed.body).toBe(409);
    expect(
      (await state(recipient)).items.find((item) => item.id === open.id)
        ?.snoozedUntil,
    ).toBeNull();
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/following", {
          projectIds: ["p", "outside-project"],
          mode: "replace",
        })
      ).statusCode,
    ).toBe(400);
    expect((await state(recipient)).followingIds).toEqual([]);
  });

  it("keeps batch assignment sources stable and closes the batch only when all assigned work is resolved", async () => {
    const editor = await login();
    const recipient = await login("recipient");
    expect(
      (
        await request(recipient, "PUT", "/api/notifications/preferences", {
          ...defaultNotificationPreferences,
          delivery: "important",
        })
      ).statusCode,
    ).toBe(200);
    const created = await request(editor, "POST", "/api/tasks/batch", {
      tasks: [input({ title: "第一项" }), input({ title: "第二项" })],
    });
    expect(created.statusCode, created.body).toBe(200);
    const tasks = created.json<Task[]>();
    const assignment = (await state(recipient)).items.find(
      (item) => item.kind === "assignment",
    )!;
    expect(assignment.taskId).toBeNull();
    expect(assignment.taskIds).toEqual(tasks.map((task) => task.id));
    expect(assignment.resolvedAt).toBeNull();
    await update(editor, tasks[0]!.id, { status: "done" });
    expect(
      (await state(recipient)).items.find((item) => item.id === assignment.id)
        ?.resolvedAt,
    ).toBeNull();
    await update(editor, tasks[1]!.id, { status: "done" });
    expect(
      (await state(recipient)).items.find((item) => item.id === assignment.id)
        ?.resolvedAt,
    ).toBeTruthy();
    expect(
      ctx.repo.db.prepare("SELECT state FROM notification_outbox").get()!.state,
    ).toBe("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
