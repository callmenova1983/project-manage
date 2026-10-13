import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";

const origin = "http://localhost:4173";
const syntheticKey = "sk-synthetic-key-never-a-real-credential";
const password = "synthetic-password-for-test";
let folder: string, databasePath: string;
let context: Awaited<ReturnType<typeof buildApp>>;
let cookie: string, csrf: string;
const fetcher = vi.fn();
async function login(email = "admin@example.test") {
  const r = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  cookie = `pm_session=${r.cookies[0]!.value}`;
  csrf = r.json().csrf;
}
const request = (method: "GET" | "PUT", url: string, payload?: unknown) =>
  context.app.inject({
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
const input = () => ({
  version: 1,
  apiKey: syntheticKey,
  region: "cn-beijing",
  maxRequests: 20,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
});
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "pm-credentials-"));
  databasePath = join(folder, "test.sqlite");
  fetcher.mockReset();
  context = await buildApp({ databasePath, origin, aiFetch: fetcher });
  context.repo.seed("a");
  for (const [email, workspaceId] of [
    ["admin@example.test", "a"],
    ["member@example.test", "a"],
    ["other@example.test", "b"],
  ])
    await createUser(context.repo, {
      email: email!,
      workspaceId: workspaceId!,
      name: email!,
      password,
    });
  context.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email!='member@example.test'")
    .run();
  await login();
});
afterEach(async () => {
  await context.app.close();
  rmSync(folder, { recursive: true, force: true });
});

it("encrypts a saved key, survives restart, stays disabled and never exposes the secret", async () => {
  const saved = await request("PUT", "/api/admin/model/credential", input());
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({
    credentialAvailable: true,
    runtimeEnabled: false,
    settings: { enabled: false, secretRef: "server-default", version: 2 },
  });
  expect(
    JSON.stringify(
      context.repo.db.prepare("SELECT * FROM workspace_ai_credentials").all(),
    ),
  ).not.toContain(syntheticKey);
  for (const table of ["idempotency", "admin_audit", "model_settings"])
    expect(
      JSON.stringify(context.repo.db.prepare(`SELECT * FROM ${table}`).all()),
    ).not.toContain(syntheticKey);
  expect(saved.body).not.toContain(syntheticKey);
  expect(statSync(databasePath + ".credentials-key").mode & 0o777).toBe(0o600);
  expect(readFileSync(databasePath + ".credentials-key")).toHaveLength(32);
  expect(fetcher).not.toHaveBeenCalled();
  await context.app.close();
  context = await buildApp({ databasePath, origin, aiFetch: fetcher });
  await login();
  const state = (await request("GET", "/api/admin/model")).json();
  expect(state.credentialAvailable).toBe(true);
  expect(state.runtimeEnabled).toBe(false);
  const enabled = await request("PUT", "/api/admin/model", {
    ...state.settings,
    enabled: true,
  });
  expect(enabled.statusCode).toBe(200);
  expect(enabled.json().runtimeEnabled).toBe(true);
  expect((await request("GET", "/api/ai/capabilities")).json().enabled).toBe(
    true,
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("denies members and keeps credentials isolated between workspaces", async () => {
  await login("member@example.test");
  expect(
    (await request("PUT", "/api/admin/model/credential", input())).statusCode,
  ).toBe(403);
  await login();
  expect(
    (await request("PUT", "/api/admin/model/credential", input())).statusCode,
  ).toBe(200);
  await login("other@example.test");
  expect(
    (await request("GET", "/api/admin/model")).json().credentialAvailable,
  ).toBe(false);
});

it("rejects unapproved endpoints and stale writes without provisioning credentials", async () => {
  const bad = await request("PUT", "/api/admin/model/credential", {
    ...input(),
    baseUrl: "https://example.test/compatible-mode/v1",
  });
  expect(bad.statusCode).toBe(400);
  expect(
    (await request("GET", "/api/admin/model")).json().credentialAvailable,
  ).toBe(false);
  expect(
    (await request("PUT", "/api/admin/model/credential", input())).statusCode,
  ).toBe(200);
  expect(
    (await request("PUT", "/api/admin/model/credential", input())).statusCode,
  ).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves consumed attempts when replacing a key and does not silently re-enable calls", async () => {
  await request("PUT", "/api/admin/model/credential", input());
  const config = (await request("GET", "/api/admin/model")).json();
  const budget =
    "workspace-" +
    (await import("node:crypto"))
      .createHash("sha256")
      .update("a")
      .digest("hex")
      .slice(0, 32);
  const user = context.repo.db
    .prepare("SELECT id FROM users WHERE email='admin@example.test'")
    .get()!;
  context.repo.db
    .prepare(
      "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
    )
    .run(randomUUID(), budget, user.id!, Date.now());
  const replacement = await request("PUT", "/api/admin/model/credential", {
    ...input(),
    version: config.settings.version,
    apiKey: "sk-synthetic-replacement",
  });
  expect(replacement.statusCode).toBe(200);
  expect(replacement.json()).toMatchObject({
    remainingAttempts: 19,
    runtimeEnabled: false,
  });
});
