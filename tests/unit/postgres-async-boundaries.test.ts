import { expect, it, vi } from "vitest";
import { AiError, generateJson } from "../../apps/api/src/ai/provider.js";
import { readQwenConfig } from "../../apps/api/src/ai/config.js";
import { NotificationWecomSender } from "../../apps/api/src/notification-wecom.js";
import { assignLoginName } from "../../apps/api/src/login-name.js";
import type { PostgresDatabase } from "../../apps/api/src/postgres.js";

const config = readQwenConfig({
  AI_PROVIDER: "qwen",
  AI_CALLS_ENABLED: "true",
  QWEN_REGION: "cn-beijing",
  QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DASHSCOPE_API_KEY: "synthetic-unit-key",
  AI_BUDGET_ID: "synthetic-unit-budget",
  AI_MAX_REQUESTS: "1",
  AI_BUDGET_EXPIRES_AT: "2099-01-01T00:00:00Z",
})!;

it("waits for committed allowance and metering before completing the model request", async () => {
  const order: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async () => {
    order.push("network");
    return Response.json({
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
    });
  });
  const result = await generateJson(
    {},
    config,
    async () => {
      await Promise.resolve();
      order.push("allowance-committed");
    },
    (value) => value,
    fetcher,
    async () => {
      await Promise.resolve();
      order.push("usage-recorded");
    },
  );
  order.push("completed");
  expect(result).toEqual({ ok: true });
  expect(order).toEqual([
    "allowance-committed",
    "network",
    "usage-recorded",
    "completed",
  ]);
});

it("never sends a model request when the asynchronous allowance reservation fails", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    generateJson(
      {},
      config,
      async () => {
        await Promise.resolve();
        throw new AiError(429, "AI_BUDGET_EXHAUSTED", "No allowance");
      },
      (value) => value,
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("waits for an asynchronous delivery recheck and cancels a stale notification", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ access_token: "synthetic" }));
  const sender = new NotificationWecomSender(fetcher);
  const result = await sender.send(
    {
      enabled: true,
      corpId: "synthetic",
      agentId: 1,
      secret: "synthetic",
      baseUrl: "https://example.test",
    },
    1,
    "user",
    "message",
    async () => {
      await Promise.resolve();
      return false;
    },
  );
  expect(result.state).toBe("cancelled");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]![0])).toContain("gettoken");
});

it("generates available login names from resolved database rows", async () => {
  const all = vi.fn(async () => [
    { username: "member" },
    { username: "MEMBER2" },
  ]);
  const db = { prepare: () => ({ all }) } as unknown as PostgresDatabase;
  expect(await assignLoginName(db, "Member")).toBe("member3");
  expect(all).toHaveBeenCalledTimes(1);
  await expect(assignLoginName(db, "Member", "MEMBER2")).rejects.toThrow(
    /already in use/,
  );
});
