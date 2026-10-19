import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import { type QwenConfig } from "../../apps/api/src/ai/config.js";

describe.each(["legacy", "sdk"] as const)("runtime %s", (runtime) => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string, csrf: string;
  const origin = "http://localhost:4173";
  const modelFetch = vi.fn<typeof fetch>();
  const config: QwenConfig = {
    model: "qwen-test",
    region: "cn-beijing",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "synthetic-test-token",
    budgetId: "map-translation-test",
    maxRequests: 10,
    expiresAt: Date.parse("2099-01-01"),
    timeoutMs: 1000,
    maxTokens: 2048,
    retries: 0,
  };
  const request = (
    method: "GET" | "POST" | "PUT",
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
  beforeEach(async () => {
    modelFetch.mockReset();
    ctx = await buildApp({
      databasePath: ":memory:",
      origin,
      qwen: config,
      aiRuntime: runtime,
      aiFetch: modelFetch,
    });
    ctx.repo.seed("map-translation-test");
    const password = randomUUID();
    await createUser(ctx.repo, {
      email: "location@example.test",
      name: "Location Tester",
      password,
      workspaceId: "map-translation-test",
    });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "location@example.test", password },
    });
    cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
    csrf = login.json().csrf;
  });
  afterEach(async () => ctx.app.close());

  it("translates without mutating projects, reuses successful content and enforces idempotency", async () => {
    const before = ctx.repo.snapshot("map-translation-test");
    const proposalCount = ctx.repo.db
      .prepare("SELECT count(*) AS total FROM proposals")
      .get()!.total;
    modelFetch.mockResolvedValue(
      Response.json({
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                translations: [
                  "Yunhe Toy City Hotel",
                  "Awaiting confirmation on site.",
                ],
              }),
            },
          },
        ],
      }),
    );
    const payload = {
      texts: ["云和玩具城酒店", "待现场确认。"],
      externalProcessingConfirmed: true,
    };
    const key = randomUUID();
    const first = await request(
      "POST",
      "/api/project-map/translate",
      payload,
      key,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().translations).toEqual([
      "Yunhe Toy City Hotel",
      "Awaiting confirmation on site.",
    ]);
    expect(
      (await request("POST", "/api/project-map/translate", payload)).json(),
    ).toEqual(first.json());
    expect(modelFetch).toHaveBeenCalledTimes(1);
    expect(ctx.repo.snapshot("map-translation-test").projects).toEqual(
      before.projects,
    );
    expect(
      ctx.repo.db.prepare("SELECT count(*) AS total FROM proposals").get()!
        .total,
    ).toBe(proposalCount);
    const conflict = await request(
      "POST",
      "/api/project-map/translate",
      { ...payload, texts: ["其他项目"] },
      key,
    );
    expect(conflict.statusCode).toBe(409);
  });

  it("rejects mixed-language model output instead of displaying Chinese as a translation", async () => {
    modelFetch.mockResolvedValue(
      Response.json({
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { content: '{"translations":["云和 Hotel"]}' },
          },
        ],
      }),
    );
    const response = await request("POST", "/api/project-map/translate", {
      texts: ["云和酒店"],
      externalProcessingConfirmed: true,
    });
    expect(response.statusCode).toBe(502);
  });

  it("does not contact a model for invalid input or an unauthenticated request", async () => {
    const response = await request("POST", "/api/project-map/translate", {
      texts: ["名称"],
      externalProcessingConfirmed: false,
    });
    expect(response.statusCode).toBe(400);
    const anonymous = await ctx.app.inject({
      method: "POST",
      url: "/api/project-map/translate",
      payload: { texts: ["名称"], externalProcessingConfirmed: true },
    });
    expect(anonymous.statusCode).toBeGreaterThanOrEqual(400);
    expect(modelFetch).not.toHaveBeenCalled();
  });
});
