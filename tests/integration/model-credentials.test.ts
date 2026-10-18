import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { QwenCredentialStore } from "../../apps/api/src/ai/credentials";

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
it.each(["sdk", "legacy"] as const)(
  "uses the %s server override with stored workspace credentials",
  async (runtime) => {
    expect(
      (await request("PUT", "/api/admin/model/credential", input())).statusCode,
    ).toBe(200);
    const state = (await request("GET", "/api/admin/model")).json();
    expect(
      (
        await request("PUT", "/api/admin/model", {
          ...state.settings,
          enabled: true,
        })
      ).statusCode,
    ).toBe(200);
    await context.app.close();
    context = await buildApp({
      databasePath,
      origin,
      aiFetch: fetcher,
      aiRuntime: runtime,
    });
    await login();
    fetcher.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.stream).toBe(runtime === "legacy" ? false : undefined);
      return Response.json({
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"suggestions":[]}' },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });
    });
    const key = randomUUID();
    const propose = () =>
      context.app.inject({
        method: "POST",
        url: "/api/proposals/qwen",
        headers: {
          origin,
          cookie,
          "x-csrf-token": csrf,
          "idempotency-key": key,
        },
        payload: { source: "设备检查", externalProcessingConfirmed: true },
      });
    const result = await propose();
    expect(result.statusCode).toBe(200);
    expect((await propose()).body).toBe(result.body);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const logs = context.repo.db
      .prepare("SELECT data FROM model_logs WHERE workspace_id=?")
      .all("a");
    expect(logs).toHaveLength(1);
    expect(JSON.parse(String(logs[0]!.data))).toMatchObject({
      runtime,
      attempts: 1,
      inputTokens: 5,
      outputTokens: 3,
    });
    expect(
      new QwenCredentialStore(context.repo, databasePath).read("a")!.runtime,
    ).toBe("legacy");
  },
);
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

it("renews an allowance without re-entering or changing the key, clearing history or changing enablement", async () => {
  await request("PUT", "/api/admin/model/credential", input());
  const current = (await request("GET", "/api/admin/model")).json();
  const enabled = (
    await request("PUT", "/api/admin/model", {
      ...current.settings,
      enabled: true,
    })
  ).json();
  const store = new QwenCredentialStore(context.repo, databasePath);
  const before = store.read("a")!;
  const userId = context.repo.db
    .prepare("SELECT id FROM users WHERE email=?")
    .get("admin@example.test")!.id;
  for (let i = 0; i < 2; i++)
    context.repo.db
      .prepare(
        "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
      )
      .run(randomUUID(), before.budgetId, userId, Date.now());
  const ledger = context.repo.db
    .prepare("SELECT * FROM ai_attempts ORDER BY id")
    .all();
  const expiresAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const saved = await request("PUT", "/api/admin/model/allowance", {
    version: enabled.settings.version,
    maxRequests: 25,
    expiresAt,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toMatchObject({
    allowanceEditable: true,
    usedAttempts: 2,
    maxRequests: 25,
    remainingAttempts: 23,
    expiresAt,
    runtimeEnabled: true,
    settings: { ...enabled.settings, version: enabled.settings.version + 1 },
  });
  expect(store.read("a")).toEqual({
    ...before,
    maxRequests: 25,
    expiresAt: Date.parse(expiresAt),
  });
  expect(
    context.repo.db.prepare("SELECT * FROM ai_attempts ORDER BY id").all(),
  ).toEqual(ledger);
  expect(saved.body).not.toContain(syntheticKey);
  expect(fetcher).not.toHaveBeenCalled();
  await context.app.close();
  context = await buildApp({ databasePath, origin, aiFetch: fetcher });
  await login();
  expect((await request("GET", "/api/admin/model")).json()).toMatchObject({
    usedAttempts: 2,
    remainingAttempts: 23,
    expiresAt,
    runtimeEnabled: true,
  });
  expect((await request("GET", "/api/admin/audit")).body).not.toContain(
    syntheticKey,
  );
});

it("rejects unauthorized, stale, expired and invalid allowance changes atomically", async () => {
  await request("PUT", "/api/admin/model/credential", input());
  const state = (await request("GET", "/api/admin/model")).json();
  const payload = {
    version: state.settings.version,
    maxRequests: 30,
    expiresAt: input().expiresAt,
  };
  const before = context.repo.db
    .prepare("SELECT * FROM workspace_ai_credentials")
    .all();
  await login("member@example.test");
  expect(
    (await request("PUT", "/api/admin/model/allowance", payload)).statusCode,
  ).toBe(403);
  await login("other@example.test");
  expect(
    (await request("PUT", "/api/admin/model/allowance", payload)).statusCode,
  ).toBe(409);
  await login();
  expect(
    (
      await context.app.inject({
        method: "PUT",
        url: "/api/admin/model/allowance",
        headers: { origin, cookie },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  for (const [patch, status] of [
    [{ version: 1 }, 409],
    [{ maxRequests: 0 }, 400],
    [{ apiKey: syntheticKey }, 400],
    [{ expiresAt: new Date(Date.now() - 60000).toISOString() }, 400],
  ] as const) {
    expect(
      (
        await request("PUT", "/api/admin/model/allowance", {
          ...payload,
          ...patch,
        })
      ).statusCode,
    ).toBe(status);
  }
  expect(
    context.repo.db.prepare("SELECT * FROM workspace_ai_credentials").all(),
  ).toEqual(before);
  expect((await request("GET", "/api/admin/model")).json()).toEqual(state);
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps operator-provisioned limits read-only", async () => {
  await request("PUT", "/api/admin/model/credential", input());
  const config = new QwenCredentialStore(context.repo, databasePath).read("a")!;
  await context.app.close();
  context = await buildApp({
    databasePath,
    origin,
    qwen: config,
    aiFetch: fetcher,
  });
  await login();
  const state = (await request("GET", "/api/admin/model")).json();
  expect(state).toMatchObject({
    allowanceEditable: false,
    maxRequests: 20,
    usedAttempts: 0,
  });
  expect(
    (
      await request("PUT", "/api/admin/model/allowance", {
        version: state.settings.version,
        maxRequests: 100,
        expiresAt: input().expiresAt,
      })
    ).statusCode,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
