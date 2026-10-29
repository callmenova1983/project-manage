import { testDatabaseConfig } from "../pg-helpers.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app";
import { createUser, hashToken } from "../../apps/api/src/auth";
import {
  projectInput,
  taskInput,
  statistics,
  type Actor,
} from "../../packages/domain/types";

let context: Awaited<ReturnType<typeof buildApp>>;
let cookie: string,
  csrf: string,
  member: Actor,
  password: string,
  foreignId: string;
const origin = "http://localhost:4173";
async function login(email = "member@example.test") {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return {
    cookie: `pm_session=${response.cookies[0]!.value}`,
    csrf: response.json().csrf as string,
  };
}
function browser(
  method: "GET" | "POST" | "DELETE",
  url = "/api/ai-access/token",
) {
  return context.app.inject({
    method,
    url,
    headers: { cookie, origin, "x-csrf-token": csrf },
    ...(method === "POST" ? { payload: {} } : {}),
  });
}
async function issue() {
  const response = await browser("POST");
  expect(response.statusCode).toBe(200);
  return response.json().token as string;
}
function bearer(
  token: string,
  url: string,
  method: "GET" | "POST" | "PUT" = "GET",
  payload?: unknown,
  key = randomUUID(),
) {
  return context.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
  });
}
beforeEach(async () => {
  context = await buildApp({ isolatedDatabase: true, origin });
  await context.repo.seed("a");
  await context.repo.seed("b");
  foreignId = randomUUID();
  await context.repo.putProject("b", {
    ...(await context.repo.snapshot("b")).projects[0]!,
    id: foreignId,
  });
  password = randomBytes(24).toString("hex");
  for (const email of ["member@example.test", "other@example.test"]) {
    await createUser(context.repo, {
      email,
      name: email,
      workspaceId: "a",
      password,
    });
  }
  ({ cookie, csrf } = await login());
  member = (await browser("GET", "/api/auth/session")).json().actor;
});
afterEach(async () => {
  await context.app.close();
});

it("returns all accessible projects and accurate leaf-task counts without selecting a project", async () => {
  const token = await issue();
  const result = await bearer(token, "/api/ai-access/context");
  expect(result.statusCode).toBe(200);
  const value = result.json();
  const snapshot = await context.repo.snapshot("a");
  expect(value.actor).toEqual(member);
  expect(value.projectCount).toBeGreaterThan(1);
  expect(value.projects.map((p: { id: string }) => p.id)).toEqual(
    snapshot.projects.map((p) => p.id),
  );
  expect(value.taskOverview).toMatchObject({
    ...statistics(snapshot.tasks),
    recordCount: snapshot.tasks.length,
  });
  for (const project of value.projects)
    expect(project.tasks).toEqual(
      statistics(snapshot.tasks.filter((t) => t.projectId === project.id)),
    );
  expect(result.body).not.toContain(token);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect((await bearer(token, "/api/projects")).json()).toHaveLength(
    snapshot.projects.length,
  );
  expect((await bearer(token, "/api/projects/" + foreignId)).statusCode).toBe(
    404,
  );
});

it("keeps only hashes, exposes metadata only and never caches a raw secret in idempotency", async () => {
  const token = await issue();
  const stored = (await context.repo.db
    .prepare("SELECT * FROM personal_access_tokens WHERE user_id=?")
    .get(member.id))!;
  expect(stored.token_hash).toBe(hashToken(token));
  expect(JSON.stringify(stored)).not.toContain(token);
  expect((await browser("GET")).json().token).toMatchObject({
    prefix: token.slice(0, 14),
    lastUsedAt: null,
  });
  expect((await browser("GET")).body).not.toContain(token);
  expect(
    (await context.repo.db
      .prepare("SELECT COUNT(*) AS n FROM idempotency")
      .get())!.n,
  ).toBe(0);
  await bearer(token, "/api/ai-access/context");
  expect((await browser("GET")).json().token.lastUsedAt).toEqual(
    expect.any(String),
  );
});

it("allows ordinary writes without cookies/CSRF/Origin while preserving audit, idempotency and version conflicts", async () => {
  const token = await issue();
  const snapshot = await context.repo.snapshot("a");
  const payload = {
    ...taskInput.strip().parse(snapshot.tasks[0]),
    title: "Created via personal AI access",
  };
  const key = randomUUID();
  const created = await bearer(token, "/api/tasks", "POST", payload, key);
  expect(created.statusCode).toBe(200);
  const task = created.json();
  expect(
    (await bearer(token, "/api/tasks", "POST", payload, key)).json(),
  ).toEqual(task);
  expect(
    (
      await bearer(
        token,
        "/api/tasks",
        "POST",
        { ...payload, title: "Different" },
        key,
      )
    ).statusCode,
  ).toBe(409);
  const update = {
    ...taskInput.strip().parse(task),
    version: task.version,
    title: "Updated via personal access",
  };
  expect(
    (await bearer(token, `/api/tasks/${task.id}`, "PUT", update)).statusCode,
  ).toBe(200);
  expect(
    (await bearer(token, `/api/tasks/${task.id}`, "PUT", update)).statusCode,
  ).toBe(409);
  expect(
    (await context.repo.snapshot("a")).activities.find(
      (a) => a.entityId === task.id,
    ),
  ).toMatchObject({ actorId: member.id, actor: member.name });
  const foreign = (await context.repo.snapshot("b")).projects.find(
    (p) => p.id === foreignId,
  )!;
  expect(
    (
      await bearer(token, `/api/projects/${foreign.id}`, "PUT", {
        ...projectInput.strip().parse(foreign),
        version: foreign.version,
      })
    ).statusCode,
  ).toBe(404);
});

it("rotates and revokes immediately and never revokes a different member's token", async () => {
  const first = await issue();
  const second = await issue();
  expect((await bearer(first, "/api/projects")).statusCode).toBe(401);
  const ownerSession = { cookie, csrf };
  ({ cookie, csrf } = await login("other@example.test"));
  expect((await browser("GET")).json()).toEqual({ token: null });
  const other = await issue();
  await browser("DELETE");
  expect((await bearer(other, "/api/projects")).statusCode).toBe(401);
  expect((await bearer(second, "/api/projects")).statusCode).toBe(200);
  ({ cookie, csrf } = ownerSession);
  expect((await browser("DELETE")).statusCode).toBe(200);
  expect((await browser("DELETE")).statusCode).toBe(200);
  expect((await bearer(second, "/api/projects")).statusCode).toBe(401);
});

it("uses live account state and role; disabling or requiring activation invalidates access", async () => {
  const token = await issue();
  expect((await bearer(token, "/api/admin/users")).statusCode).toBe(403);
  await context.repo.db
    .prepare("UPDATE users SET role='admin' WHERE id=?")
    .run(member.id);
  expect((await bearer(token, "/api/admin/users")).statusCode).toBe(200);
  await context.repo.db
    .prepare("UPDATE users SET role='member' WHERE id=?")
    .run(member.id);
  expect((await bearer(token, "/api/admin/users")).statusCode).toBe(403);
  await context.repo.db
    .prepare("UPDATE users SET status='disabled' WHERE id=?")
    .run(member.id);
  expect((await bearer(token, "/api/projects")).statusCode).toBe(401);
  await context.repo.db
    .prepare(
      "UPDATE users SET status='active',requires_activation=1 WHERE id=?",
    )
    .run(member.id);
  expect((await bearer(token, "/api/projects")).statusCode).toBe(401);
});

it("requires cookie+CSRF for credential management and keeps browser origin defenses intact", async () => {
  expect((await context.app.inject("/api/ai-access/context")).statusCode).toBe(
    401,
  );
  expect((await context.app.inject("/api/ai-access/docs")).statusCode).toBe(
    401,
  );
  expect(
    (
      await context.app.inject({
        method: "POST",
        url: "/api/ai-access/token",
        headers: { cookie, origin },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await context.app.inject({
        method: "DELETE",
        url: "/api/ai-access/token",
        headers: { cookie, origin, "x-csrf-token": "wrong" },
      })
    ).statusCode,
  ).toBe(403);
  const token = await issue();
  for (const url of [
    "/api/ai-access/token",
    "/api/ai-access/%74oken",
    "/api/auth/session",
  ]) {
    expect((await bearer(token, url)).statusCode).toBe(403);
  }
  expect(
    (await bearer(token, "/api/ai-access/token", "POST", {})).statusCode,
  ).toBe(403);
  expect(
    (
      await context.app.inject({
        url: "/api/projects",
        headers: { cookie, authorization: "Bearer invalid" },
      })
    ).statusCode,
  ).toBe(401);
  const payload = taskInput
    .strip()
    .parse((await context.repo.snapshot("a")).tasks[0]);
  expect(
    (
      await context.app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://foreign.example",
          "idempotency-key": randomUUID(),
        },
        payload,
      })
    ).statusCode,
  ).toBe(403);
});

it("serves machine-readable contracts from current validators and discovers registered routes", async () => {
  const token = await issue();
  const response = await bearer(token, "/api/ai-access/docs");
  expect(response.statusCode).toBe(200);
  const docs = response.json();
  expect(docs.format).toBe("pm-http-api-reference");
  expect(
    docs.endpoints.find(
      (e: { method: string; path: string }) =>
        e.method === "POST" && e.path === "/api/tasks",
    ).body.required,
  ).toContain("projectId");
  expect(
    docs.endpoints.find(
      (e: { method: string; path: string }) =>
        e.method === "PUT" && e.path === "/api/tasks/:id",
    ).body.required,
  ).toContain("version");
  expect(
    docs.endpoints.some(
      (e: { path: string }) => e.path === "/api/ai-access/token",
    ),
  ).toBe(false);
  expect(
    docs.endpoints.some(
      (e: { path: string }) => e.path === "/api/auth/session",
    ),
  ).toBe(false);
  expect(docs.endpoints).toContainEqual(
    expect.objectContaining({
      method: "GET",
      path: "/api/admin/users",
      requiresRole: "admin",
    }),
  );
  expect(response.body).not.toContain(token);
  expect((await browser("GET", "/api/ai-access/docs")).statusCode).toBe(200);
});

it("persists credentials across restarts without changing existing workspace records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-ai-access-"));
  const databasePath = join(dir, "test.sqlite");
  let instance = await buildApp({
    database: testDatabaseConfig(databasePath),
    origin,
  });
  let closed = false;
  try {
    await instance.repo.seed("existing");
    const original = await instance.repo.snapshot("existing");
    await createUser(instance.repo, {
      email: "restart@example.test",
      name: "Restart Member",
      password,
      workspaceId: "existing",
    });
    const signedIn = await instance.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { email: "restart@example.test", password },
    });
    const generated = await instance.app.inject({
      method: "POST",
      url: "/api/ai-access/token",
      headers: {
        origin,
        cookie: `pm_session=${signedIn.cookies[0]!.value}`,
        "x-csrf-token": signedIn.json().csrf,
      },
      payload: {},
    });
    expect(generated.statusCode).toBe(200);
    const token = generated.json().token;
    await instance.app.close();
    closed = true;
    instance = await buildApp({
      database: testDatabaseConfig(databasePath),
      origin,
    });
    closed = false;
    const loaded = await instance.app.inject({
      url: "/api/ai-access/context",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().actor.name).toBe("Restart Member");
    expect((await instance.repo.snapshot("existing")).projects).toEqual(
      original.projects,
    );
    expect((await instance.repo.snapshot("existing")).tasks).toEqual(
      original.tasks,
    );
    expect(
      (await instance.repo.db
        .prepare(
          "SELECT COUNT(*) AS n FROM pm_schema_migrations WHERE version=1",
        )
        .get())!.n,
    ).toBe(1);
  } finally {
    if (!closed) await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
