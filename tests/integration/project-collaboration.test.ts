import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { taskInput, type Snapshot } from "../../packages/domain/types";
import { isCompletionAction } from "../../apps/web/src/composables/activity-summary";
import { emptyDirectory } from "../../packages/domain/directory";
let context: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173";
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("a");
  const password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    name: "Member",
    email: "member@example.test",
    workspaceId: "a",
    password,
  });
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "member@example.test", password },
  });
  cookie = `pm_session=${response.cookies[0]!.value}`;
  csrf = response.json().csrf;
});
afterEach(async () => {
  await context.app.close();
});
const request = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  context.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
const snapshot = async () =>
  (await request("GET", "/api/workspace")).json<Snapshot>();

it("quick rename preserves reports and notes, detects conflicts, and joins the editor once", async () => {
  const s = await snapshot(),
    p = s.projects[0]!;
  expect(s.projectMembers).toEqual([]);
  const renamed = await request("PUT", `/api/projects/${p.id}/name`, {
    name: "School",
    shortName: "S",
    version: p.version,
  });
  expect(renamed.statusCode).toBe(200);
  expect(renamed.json()).toMatchObject({
    ...p,
    name: "School",
    shortName: "S",
    version: p.version + 1,
    updatedAt: expect.any(String),
  });
  expect(
    (
      await request("PUT", `/api/projects/${p.id}/name`, {
        name: "Stale",
        version: p.version,
      })
    ).statusCode,
  ).toBe(409);
  const after = await snapshot();
  expect(after.projectMembers).toHaveLength(1);
  expect(after.projects[0]!.reportedAt).toBe(p.reportedAt);
  const second = await request("PUT", `/api/projects/${p.id}/name`, {
    name: "Another name",
    version: p.version + 1,
  });
  expect(second.statusCode).toBe(200);
  expect((await snapshot()).projectMembers).toHaveLength(1);
});

it("merges full task trees and original audit facts atomically, with idempotent retries", async () => {
  let s = await snapshot();
  const source = s.projects[0]!,
    target = s.projects[1]!;
  const leaf = s.tasks.find(
    (t) =>
      t.projectId === source.id &&
      t.status !== "done" &&
      !s.tasks.some((child) => child.parentId === t.id),
  )!;
  expect(
    (
      await request("PUT", `/api/tasks/${leaf.id}`, {
        ...taskInput.strip().parse(leaf),
        status: "done",
        version: leaf.version,
      })
    ).statusCode,
  ).toBe(200);
  s = await snapshot();
  const originalEvent = s.activities.find(
    (a) => a.entityId === leaf.id && isCompletionAction(a),
  )!;
  const body = {
    targetId: target.id,
    sourceIds: [source.id],
    name: "Combined school",
    revision: s.revision,
    confirmed: true,
  };
  const key = randomUUID(),
    result = await request("POST", "/api/projects/merge", body, key);
  expect(result.statusCode).toBe(200);
  expect(
    (await request("POST", "/api/projects/merge", body, key)).json(),
  ).toEqual(result.json());
  const after = await snapshot();
  expect(after.projects).toHaveLength(s.projects.length - 1);
  expect(after.tasks).toHaveLength(s.tasks.length);
  for (const task of s.tasks) {
    const actual = after.tasks.find((t) => t.id === task.id)!;
    expect(actual).toMatchObject({
      ...task,
      projectId: task.projectId === source.id ? target.id : task.projectId,
      version: task.version + (task.projectId === source.id ? 1 : 0),
      updatedAt: expect.any(String),
    });
  }
  const migratedEvent = after.activities.find(
    (a) => a.id === originalEvent.id,
  )!;
  expect(migratedEvent).toMatchObject({
    projectId: target.id,
    originalProjectId: source.id,
    before: originalEvent.before,
    after: originalEvent.after,
  });
  expect(isCompletionAction(migratedEvent)).toBe(true);
  expect(
    after.projectMembers!.filter((m) => m.projectId === target.id),
  ).toHaveLength(1);
  const mergeEvent = after.activities.find(
    (a) => a.action === "Merged projects",
  )!;
  expect(
    (
      await request("POST", `/api/activities/${mergeEvent.id}/restore`, {
        version: result.json().version,
      })
    ).statusCode,
  ).toBe(400);
  // Restoring an older task status must not resurrect its removed source project.
  const restored = await request(
    "POST",
    `/api/activities/${originalEvent.id}/restore`,
    { version: after.tasks.find((t) => t.id === leaf.id)!.version },
  );
  expect(restored.statusCode).toBe(200);
  expect(restored.json().projectId).toBe(target.id);
  expect(context.repo.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("rejects stale or oversized merges without partial writes", async () => {
  const s = await snapshot(),
    target = s.projects[0]!,
    source = s.projects[1]!;
  const body = {
    targetId: target.id,
    sourceIds: [source.id],
    name: "Combined",
    revision: s.revision,
    confirmed: true,
  };
  await request("PUT", `/api/projects/${target.id}/name`, {
    name: "New edit",
    version: target.version,
  });
  const current = await snapshot();
  expect((await request("POST", "/api/projects/merge", body)).statusCode).toBe(
    409,
  );
  expect(await snapshot()).toEqual(current);
  context.repo.putProject("a", {
    ...current.projects.find((p) => p.id === target.id)!,
    notes: "a".repeat(15000),
  });
  context.repo.putProject("a", { ...source, notes: "b".repeat(15000) });
  const large = await snapshot();
  expect(
    (
      await request("POST", "/api/projects/merge", {
        ...body,
        revision: large.revision,
      })
    ).statusCode,
  ).toBe(400);
  expect(await snapshot()).toEqual(large);
});

it("auto joins task editors but keeps directory writes restricted to administrators", async () => {
  const s = await snapshot(),
    leaf = s.tasks.find(
      (t) => !s.tasks.some((child) => child.parentId === t.id),
    )!;
  await request("PUT", `/api/tasks/${leaf.id}`, {
    ...taskInput.strip().parse(leaf),
    title: "Edited task",
    version: leaf.version,
  });
  expect((await snapshot()).projectMembers).toMatchObject([
    { projectId: leaf.projectId, name: "Member" },
  ]);
  const company = {
    ...emptyDirectory(),
    companyName: "Company",
    departments: [
      { id: "tech", name: "Technical", parentId: null, wecomId: null },
    ],
    employees: [],
  };
  expect((await request("PUT", "/api/directory", company)).statusCode).toBe(
    403,
  );
  context.repo.db.prepare("UPDATE users SET role='admin'").run();
  expect((await request("PUT", "/api/directory", company)).statusCode).toBe(
    200,
  );
  expect((await request("PUT", "/api/directory", company)).statusCode).toBe(
    409,
  );
  expect((await request("GET", "/api/directory")).json()).toMatchObject({
    companyName: "Company",
    version: 2,
  });
  expect(
    (
      await request("POST", "/api/directory/wecom/sync", {
        version: 2,
        confirmed: true,
      })
    ).statusCode,
  ).toBe(503);
});

it("does not let foreign project IDs cross workspace boundaries", async () => {
  context.repo.seed("b");
  const before = await snapshot(),
    source = before.projects[0]!,
    target = before.projects[1]!;
  const foreign = { ...source, id: "foreign", name: "Other company" };
  context.repo.putProject("b", foreign);
  expect(
    (
      await request("POST", "/api/projects/merge", {
        targetId: target.id,
        sourceIds: [foreign.id],
        name: "Combined",
        revision: before.revision,
        confirmed: true,
      })
    ).statusCode,
  ).toBe(400);
  expect(await snapshot()).toEqual(before);
  expect(context.repo.get("projects", "b", foreign.id)).toEqual(foreign);
});
it("persists a complete manual order and rejects stale or incomplete orders", async () => {
  const s = await snapshot(),
    ids = [...s.projectOrder!].reverse();
  expect(
    (
      await request("PUT", "/api/project-order", {
        projectIds: ids,
        revision: s.revision,
      })
    ).statusCode,
  ).toBe(200);
  const saved = await snapshot();
  expect(saved.projectOrder).toEqual(ids);
  expect(
    (
      await request("PUT", "/api/project-order", {
        projectIds: s.projectOrder,
        revision: s.revision,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("PUT", "/api/project-order", {
        projectIds: ids.slice(1),
        revision: saved.revision,
      })
    ).statusCode,
  ).toBe(400);
  expect(await snapshot()).toEqual(saved);
});

it("appends independent progress reports, preserves corrections and rejects stale submissions", async () => {
  const before = await snapshot(),
    project = before.projects[0]!;
  const url = `/api/projects/${project.id}/progress`;
  const first = await request("POST", url, {
    text: "Site commissioning",
    version: project.version,
    mode: "new",
  });
  expect(first.statusCode).toBe(200);
  expect(first.json().reportedBy).toBe("Member");
  const repeat = await request("POST", url, {
    text: "Site commissioning",
    version: first.json().version,
    mode: "new",
  });
  expect(repeat.statusCode).toBe(200);
  const corrected = await request("POST", url, {
    text: "Site commissioning complete",
    version: repeat.json().version,
    mode: "correct",
  });
  expect(corrected.statusCode).toBe(200);
  expect(corrected.json().reportedAt).toBe(repeat.json().reportedAt);
  const history = (await request("GET", url)).json();
  expect(
    history.filter(
      (entry: { text: string }) => entry.text === "Site commissioning",
    ),
  ).toHaveLength(2);
  expect(history[0]).toMatchObject({
    text: "Site commissioning complete",
    correction: true,
    author: "Member",
  });
  const stale = await request("POST", url, {
    text: "Stale overwrite",
    version: project.version,
    mode: "new",
  });
  expect(stale.statusCode).toBe(409);
  expect((await request("GET", url)).json()).toEqual(history);
  expect((await snapshot()).tasks).toEqual(before.tasks);
  expect((await snapshot()).projectMembers).toHaveLength(1);
});

it("supports generated login names and email while preserving disabled and pending account restrictions", async () => {
  const password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    name: "郑元杰",
    email: "zheng1@example.test",
    workspaceId: "a",
    password,
  });
  await createUser(context.repo, {
    name: "郑元杰",
    email: "zheng2@example.test",
    workspaceId: "a",
    password,
  });
  const rows = context.repo.db
    .prepare("SELECT id,email,username FROM users WHERE name=? ORDER BY rowid")
    .all("郑元杰");
  expect(rows.map((r) => r.username)).toEqual(["zhengyj", "zhengyj2"]);
  const login = (email: string) =>
    context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { email, password },
    });
  expect((await login("ZHENGYJ")).statusCode).toBe(200);
  expect((await login("zheng1@example.test")).statusCode).toBe(200);
  context.repo.db
    .prepare("UPDATE users SET status='disabled' WHERE id=?")
    .run(String(rows[0]!.id));
  expect((await login("zhengyj")).statusCode).toBe(401);
  context.repo.db
    .prepare(
      "UPDATE users SET status='pending',requires_activation=1 WHERE id=?",
    )
    .run(String(rows[1]!.id));
  expect((await login("zhengyj2")).statusCode).toBe(401);
  expect((await login("unknownalias")).statusCode).toBe(401);
});

it("uses the configured default only for explicitly provisioned new accounts", async () => {
  const configuredPassword = "Fixture@26!";
  await context.app.close();
  context = await buildApp({
    databasePath: ":memory:",
    origin,
    starterPassword: configuredPassword,
  });
  context.repo.workspace("a");
  const adminPassword = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    name: "Admin",
    email: "admin@example.test",
    workspaceId: "a",
    password: adminPassword,
  });
  context.repo.db.prepare("UPDATE users SET role='admin'").run();
  const session = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "admin@example.test", password: adminPassword },
  });
  cookie = `pm_session=${session.cookies[0]!.value}`;
  csrf = session.json().csrf;
  const originalHash = context.repo.db
    .prepare("SELECT password_hash FROM users WHERE email=?")
    .get("admin@example.test")!.password_hash;
  expect((await request("GET", "/api/admin/account-defaults")).json()).toEqual({
    starterPasswordConfigured: true,
  });
  const created = await request("POST", "/api/admin/users", {
    name: "郑元杰",
    email: "zheng@example.test",
    role: "member",
    useStarterPassword: true,
  });
  expect(created.statusCode).toBe(200);
  expect(created.json()).toMatchObject({
    username: "zhengyj",
    status: "active",
    activationRequired: false,
  });
  expect(JSON.stringify(created.json())).not.toContain(configuredPassword);
  const signedIn = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "zhengyj", password: configuredPassword },
  });
  expect(signedIn.statusCode).toBe(200);
  expect(
    context.repo.db
      .prepare("SELECT password_hash FROM users WHERE email=?")
      .get("admin@example.test")!.password_hash,
  ).toBe(originalHash);
});
