import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config.js";
import type { Proposal, Snapshot } from "../../packages/domain/types.js";
let ctx: Awaited<ReturnType<typeof buildApp>>,
  dir: string,
  cookie: string,
  csrf: string;
const mock = vi.fn<typeof fetch>();
const origin = "http://localhost:4173";
const config: QwenConfig = {
  model: QWEN_MODEL,
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic-test-token",
  budgetId: "integration",
  maxRequests: 3,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 2048,
  retries: 0,
};
const source = "Atlas: acceptance completed";
function reply(projectId: string) {
  return Response.json({
    model: QWEN_MODEL,
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            suggestions: [
              {
                sourceLine: 1,
                quote: "acceptance completed",
                title: "Acceptance completed",
                projectIds: [projectId],
                reason: "Atlas name",
                action: "update",
                status: "done",
              },
            ],
          }),
        },
      },
    ],
  });
}
const request = (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
const propose = (key = randomUUID()) =>
  request(
    "POST",
    "/api/proposals/qwen",
    { source, externalProcessingConfirmed: true },
    key,
  );
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-qwen-"));
  mock.mockReset();
  ctx = await buildApp({
    databasePath: join(dir, "db.sqlite"),
    origin,
    qwen: config,
    aiFetch: mock,
  });
  ctx.repo.seed("test");
  const password = randomBytes(24).toString("hex");
  await createUser(ctx.repo, {
    email: "ai@example.test",
    name: "AI Reviewer",
    password,
    workspaceId: "test",
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "ai@example.test", password },
  });
  cookie = login.cookies[0]!.name + "=" + login.cookies[0]!.value;
  csrf = login.json().csrf;
  const project = ctx.repo.snapshot("test").projects[0]!;
  mock.mockImplementation(async () => reply(project.id));
});
afterEach(async () => {
  await ctx.app.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("Qwen HTTP integration using synthetic fetch only", () => {
  it("requires authentication, CSRF and external-processing consent before any call", async () => {
    expect((await ctx.app.inject("/api/ai/capabilities")).statusCode).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/proposals/qwen",
          payload: { source },
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request("POST", "/api/proposals/qwen", {
          source,
          externalProcessingConfirmed: false,
        })
      ).statusCode,
    ).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it("exposes safe capabilities, never keys or endpoints, and does not claim connectivity", async () => {
    const result = await request("GET", "/api/ai/capabilities");
    expect(result.json()).toMatchObject({
      enabled: true,
      model: QWEN_MODEL,
      connectionVerified: false,
      remainingAttempts: 3,
    });
    expect(result.body).not.toContain(config.apiKey);
    expect(result.body).not.toContain(config.baseUrl);
  });
  it("generates a source-backed draft, requires review/overwrite confirmation, then applies exactly once", async () => {
    const before = ctx.repo.snapshot("test");
    const key = randomUUID();
    const result = await propose(key);
    expect(result.statusCode).toBe(200);
    const proposal = result.json<Proposal>();
    expect(proposal.generator).toMatchObject({
      provider: "qwen",
      model: QWEN_MODEL,
    });
    expect(proposal.suggestions[0]).toMatchObject({
      sourceText: source,
      confirmed: false,
      overwriteConfirmed: false,
      selectedProjectId: "",
    });
    expect(ctx.repo.snapshot("test")).toEqual(before);
    expect((await propose(key)).json().id).toBe(proposal.id);
    expect(mock).toHaveBeenCalledTimes(1);
    const project = before.projects[0]!;
    const s = {
      id: proposal.suggestions[0]!.id,
      selectedProjectId: project.id,
      title: "Reviewed completion",
      action: "update",
      status: "done",
      confirmed: false,
      overwriteConfirmed: false,
      projectVersion: project.version,
    };
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [s],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [{ ...s, confirmed: true }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [{ ...s, confirmed: true, overwriteConfirmed: true }],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      ctx.repo.snapshot("test").projects.find((p) => p.id === project.id)!
        .latestUpdate,
    ).toBe("Reviewed completion");
    expect(ctx.repo.snapshot("test").activities[0]!.source).toContain(source);
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [{ ...s, confirmed: true, overwriteConfirmed: true }],
        })
      ).statusCode,
    ).toBe(409);
  });
  it("deduplicates concurrent requests while allowing no business mutation", async () => {
    let finish!: () => void;
    mock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return reply(ctx.repo.snapshot("test").projects[0]!.id);
    });
    const key = randomUUID();
    const pending = propose(key).then((r) => r);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    expect((await propose(key)).statusCode).toBe(409);
    expect((await propose()).json().code).toBe("AI_BUSY");
    finish();
    expect((await pending).statusCode).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("persists failed attempts and idempotency across restart and enforces total budget", async () => {
    mock.mockImplementation(
      async () => new Response("provider-private-debug", { status: 401 }),
    );
    const key = randomUUID();
    const failed = await propose(key);
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("provider-private-debug");
    expect((await propose(key)).statusCode).toBe(503);
    expect(mock).toHaveBeenCalledTimes(1);
    await ctx.app.close();
    ctx = await buildApp({
      databasePath: join(dir, "db.sqlite"),
      origin,
      qwen: config,
      aiFetch: mock,
    });
    expect(
      (await request("GET", "/api/ai/capabilities")).json().remainingAttempts,
    ).toBe(2);
    expect((await propose(key)).statusCode).toBe(503);
    expect(mock).toHaveBeenCalledTimes(1);
    await propose();
    await propose();
    expect((await propose()).json().code).toBe("AI_BUDGET");
    expect(mock).toHaveBeenCalledTimes(3);
    expect((await request("GET", "/api/ai/capabilities")).json().enabled).toBe(
      false,
    );
  });
  it("rejects hallucinated project IDs and confirmation injection with no proposal or project writes", async () => {
    const before: Snapshot = ctx.repo.snapshot("test");
    mock.mockResolvedValueOnce(reply("foreign-workspace-project"));
    expect((await propose()).json().code).toBe("AI_INVALID_OUTPUT");
    expect(ctx.repo.snapshot("test")).toEqual(before);
    expect(
      ctx.repo.db.prepare("SELECT count(*) AS n FROM proposals").get()!.n,
    ).toBe(0);
  });
  it("default server remains rules-only even when a Qwen route is requested", async () => {
    await ctx.app.close();
    ctx = await buildApp({
      databasePath: join(dir, "db.sqlite"),
      origin,
      aiFetch: mock,
    });
    expect((await request("GET", "/api/ai/capabilities")).json().enabled).toBe(
      false,
    );
    expect((await propose()).json().code).toBe("AI_DISABLED");
    expect(mock).not.toHaveBeenCalled();
    expect(
      (await request("POST", "/api/proposals", { source })).statusCode,
    ).toBe(200);
  });
});

it("records safe actual usage metadata and workspace settings can disable future calls", async () => {
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='ai@example.test'")
    .run();
  mock.mockImplementation(async () => {
    const body = await reply(ctx.repo.snapshot("test").projects[0]!.id).json();
    return Response.json({
      ...body,
      usage: { prompt_tokens: 120, completion_tokens: 45 },
    });
  });
  const key = randomUUID();
  expect((await propose(key)).statusCode).toBe(200);
  await propose(key);
  const result = await request("GET", "/api/admin/model/logs");
  expect(result.statusCode).toBe(200);
  expect(result.json()).toHaveLength(1);
  expect(result.json()[0]).toMatchObject({
    status: "succeeded",
    provider: "qwen",
    model: QWEN_MODEL,
    mode: "real",
    inputTokens: 120,
    outputTokens: 45,
    cost: null,
    attempts: 1,
  });
  expect(result.json()[0].durationMs).toBeGreaterThanOrEqual(0);
  expect(result.body).not.toContain(source);
  expect(result.body).not.toContain(config.apiKey);
  expect(result.body).not.toContain("suggestions");
  const state = (await request("GET", "/api/admin/model")).json();
  const saved = await ctx.app.inject({
    method: "PUT",
    url: "/api/admin/model",
    headers: {
      cookie,
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: { ...state.settings, enabled: false },
  });
  expect(saved.statusCode).toBe(200);
  expect((await propose()).statusCode).toBe(503);
  expect(mock).toHaveBeenCalledTimes(1);
});
it("records failed provider status without source data, generated text or fabricated usage", async () => {
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='ai@example.test'")
    .run();
  mock.mockResolvedValue(
    Response.json({ secret: "should never be logged" }, { status: 503 }),
  );
  expect((await propose()).statusCode).toBe(503);
  const result = await request("GET", "/api/admin/model/logs");
  expect(result.json()[0]).toMatchObject({
    status: "failed",
    inputTokens: null,
    outputTokens: null,
    cost: null,
    errorCode: "AI_PROVIDER",
    attempts: 1,
  });
  expect(result.body).not.toContain("should never be logged");
});

it("retains reported usage for truncated output while recording failure and exactly one paid attempt", async () => {
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='ai@example.test'")
    .run();
  mock.mockResolvedValue(
    Response.json({
      model: QWEN_MODEL,
      usage: { prompt_tokens: 140, completion_tokens: 2048 },
      choices: [
        {
          finish_reason: "length",
          message: { content: "Incomplete synthetic output" },
        },
      ],
    }),
  );
  const key = randomUUID();
  expect((await propose(key)).json().code).toBe("AI_INVALID_OUTPUT");
  expect((await propose(key)).json().code).toBe("AI_INVALID_OUTPUT");
  expect(mock).toHaveBeenCalledTimes(1);
  const logs = (await request("GET", "/api/admin/model/logs")).json();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    status: "failed",
    errorCode: "AI_INVALID_OUTPUT",
    attempts: 1,
    inputTokens: 140,
    outputTokens: 2048,
    cost: null,
  });
  expect((await request("GET", "/api/admin/model")).json()).toMatchObject({
    runtimeEnabled: true,
    remainingAttempts: 2,
  });
  expect(JSON.stringify(logs)).not.toContain("Incomplete synthetic output");
});

it("counts failed attempts toward exhaustion without inventing a provider log for a blocked request", async () => {
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='ai@example.test'")
    .run();
  mock.mockImplementation(async () => Response.json({}, { status: 503 }));
  for (let i = 0; i < 3; i++)
    expect((await propose()).json().code).toBe("AI_PROVIDER");
  expect((await propose()).json().code).toBe("AI_BUDGET");
  expect(mock).toHaveBeenCalledTimes(3);
  expect((await request("GET", "/api/admin/model")).json()).toMatchObject({
    credentialAvailable: true,
    runtimeEnabled: false,
    remainingAttempts: 0,
  });
  expect((await request("GET", "/api/ai/capabilities")).json()).toMatchObject({
    enabled: false,
    remainingAttempts: 0,
  });
  const logs = (await request("GET", "/api/admin/model/logs")).json();
  expect(logs).toHaveLength(3);
  expect(
    logs.every(
      (log: {
        status: string;
        attempts: number;
        inputTokens: null;
        cost: null;
      }) =>
        log.status === "failed" &&
        log.attempts === 1 &&
        log.inputTokens === null &&
        log.cost === null,
    ),
  ).toBe(true);
});

it("reports an expired allowance consistently without sending a provider request", async () => {
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='ai@example.test'")
    .run();
  await ctx.app.close();
  ctx = await buildApp({
    databasePath: join(dir, "db.sqlite"),
    origin,
    qwen: { ...config, expiresAt: Date.now() - 1000 },
    aiFetch: mock,
  });
  expect((await request("GET", "/api/admin/model")).json()).toMatchObject({
    credentialAvailable: true,
    runtimeEnabled: false,
    remainingAttempts: 3,
  });
  expect((await request("GET", "/api/ai/capabilities")).json()).toMatchObject({
    enabled: false,
    remainingAttempts: 3,
  });
  expect((await propose()).json().code).toBe("AI_BUDGET");
  expect(mock).not.toHaveBeenCalled();
  expect((await request("GET", "/api/admin/model/logs")).json()).toEqual([]);
});
