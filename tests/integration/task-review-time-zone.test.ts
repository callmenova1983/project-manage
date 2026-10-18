import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config.js";

const origin = "http://localhost:4173";
const config: QwenConfig = {
  model: QWEN_MODEL,
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic-test-token",
  budgetId: "task-review-time-zone",
  maxRequests: 3,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 2048,
  retries: 0,
};
let ctx: Awaited<ReturnType<typeof buildApp>>;
let cookie: string, csrf: string;
const modelFetch = vi.fn<typeof fetch>();
const modelReply = () =>
  Response.json({
    model: QWEN_MODEL,
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify({ questions: [] }) },
      },
    ],
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:20:00Z"));
  modelFetch.mockReset().mockImplementation(async () => modelReply());
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    qwen: config,
    aiFetch: modelFetch,
  });
  ctx.repo.seed("team");
  ctx.repo.seed("other-team");
  ctx.repo.db
    .prepare("UPDATE workspaces SET time_zone=? WHERE id=?")
    .run("Asia/Shanghai", "other-team");
  const password = randomBytes(24).toString("hex");
  await createUser(ctx.repo, {
    email: "reviewer@example.test",
    name: "Synthetic reviewer",
    workspaceId: "team",
    password,
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "reviewer@example.test", password },
  });
  cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});

afterEach(async () => {
  await ctx.app.close();
  vi.useRealTimers();
});

function review(key = randomUUID()) {
  const task = ctx.repo.snapshot("team").tasks[0]!;
  return ctx.app.inject({
    method: "POST",
    url: `/api/tasks/${task.id}/review`,
    payload: { version: task.version },
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
}
function setTimeZone(timeZone: string) {
  ctx.repo.db
    .prepare("UPDATE workspaces SET time_zone=? WHERE id=?")
    .run(timeZone, "team");
}

describe("task review reads the actor workspace time zone", () => {
  it.each([
    ["UTC", "2026-10-15"],
    ["Asia/Shanghai", "2026-10-16"],
    ["Asia/Kathmandu", "2026-10-16"],
  ])(
    "passes %s to the model without changing saved task fields",
    async (timeZone, today) => {
      setTimeZone(timeZone);
      const before = ctx.repo.snapshot("team").tasks;
      expect((await review()).statusCode).toBe(200);
      expect(modelFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(modelFetch.mock.calls[0]![1]!.body));
      expect(JSON.parse(body.messages[1].content)).toMatchObject({
        timeZone,
        today,
      });
      expect(body.messages[0].content).toContain(`工作区 ${timeZone} 时区`);
      expect(ctx.repo.snapshot("team").tasks).toEqual(before);
      expect(ctx.repo.settings("team").timeZone).toBe(timeZone);
    },
  );

  it("does not reuse a successful candidate after the workspace time zone changes", async () => {
    const key = randomUUID();
    expect((await review(key)).statusCode).toBe(200);
    setTimeZone("Asia/Kathmandu");
    expect((await review(key)).statusCode).toBe(409);
    expect(modelFetch).toHaveBeenCalledTimes(1);
    expect((await review()).statusCode).toBe(200);
    const body = JSON.parse(String(modelFetch.mock.calls[1]![1]!.body));
    expect(JSON.parse(body.messages[1].content).timeZone).toBe(
      "Asia/Kathmandu",
    );
  });

  it("rejects candidates if workspace time zone changes during analysis", async () => {
    let finish!: () => void;
    modelFetch.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return modelReply();
    });
    const before = ctx.repo.snapshot("team").tasks;
    const pending = review().then((response) => response);
    await vi.waitFor(() => expect(modelFetch).toHaveBeenCalledTimes(1));
    setTimeZone("Asia/Shanghai");
    finish();
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("AI_STALE");
    expect(ctx.repo.snapshot("team").tasks).toEqual(before);
  });
});
