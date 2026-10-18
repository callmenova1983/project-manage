import { expect, it } from "vitest";
import type { ModelLog } from "../../packages/domain/admin";
import { recordModelCallUsage } from "../../apps/api/src/ai/usage";

function log(): ModelLog {
  return {
    id: "test",
    createdAt: "2026-10-18T00:00:00Z",
    actor: "test",
    provider: "qwen",
    model: "test-model",
    mode: "real",
    status: "started",
    attempts: 1,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    errorCode: null,
    cost: null,
  };
}
it("totals successive real calls and replaces a repeated final reading", () => {
  const value = log();
  recordModelCallUsage(value, { inputTokens: 10, outputTokens: 3 });
  value.attempts = 2;
  recordModelCallUsage(value, { inputTokens: 20, outputTokens: 5 });
  recordModelCallUsage(value, { inputTokens: 20, outputTokens: 5 });
  expect(value).toMatchObject({
    inputTokens: 30,
    outputTokens: 8,
    meteredAttempts: 2,
  });
  expect(value.callUsage).toHaveLength(2);
});
it("keeps a missing retry reading unknown, including when later usage is zero", () => {
  const value = log();
  value.attempts = 2;
  recordModelCallUsage(value, { inputTokens: 0, outputTokens: 0 });
  expect(value).toMatchObject({
    inputTokens: 0,
    outputTokens: 0,
    meteredAttempts: 1,
  });
  expect(value.callUsage).toEqual([
    { attempt: 2, inputTokens: 0, outputTokens: 0 },
  ]);
});
it("retains valid partial usage without inventing a complete measurement", () => {
  const value = log();
  recordModelCallUsage(value, { inputTokens: 12, outputTokens: null });
  value.attempts = 2;
  recordModelCallUsage(value, { inputTokens: Number.NaN, outputTokens: -1 });
  expect(value).toMatchObject({
    inputTokens: 12,
    outputTokens: null,
    meteredAttempts: 0,
  });
});
it("requires a reserved attempt before accepting usage", () => {
  const value = log();
  value.attempts = 0;
  expect(() =>
    recordModelCallUsage(value, { inputTokens: 1, outputTokens: 1 }),
  ).toThrow("reserved");
});
