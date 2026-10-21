import { describe, it, expect, vi } from "vitest";
import { readQwenConfig, QWEN_MODEL } from "../../apps/api/src/ai/config.js";
import { generateJson } from "../../apps/api/src/ai/provider.js";

import { createSeed } from "../../packages/domain/seed.js";
const projects = createSeed().projects;
const source = "Atlas: acceptance checklist completed";
const item = {
  sourceLine: 1,
  quote: "acceptance checklist completed",
  title: "Acceptance checklist completed",
  projectIds: [projects[0]!.id],
  reason: "Atlas appears in source",
  action: "task",
  status: "done",
};
const env = {
  AI_PROVIDER: "qwen",
  AI_CALLS_ENABLED: "true",
  QWEN_REGION: "cn-beijing",
  QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DASHSCOPE_API_KEY: "synthetic-test-token",
  AI_BUDGET_ID: "unit-tests",
  AI_MAX_REQUESTS: "3",
  AI_BUDGET_EXPIRES_AT: "2099-01-01T00:00:00Z",
};
const config = readQwenConfig(env)!;
// Transport-only fixture; business interpretation is covered by assistant-turn tests.
const runModel = (
  _source: string,
  _projects: unknown,
  config: Parameters<typeof generateJson>[1],
  reserve: () => void,
  fetcher: typeof fetch,
) =>
  generateJson(
    {
      model: config.model,
      messages: [
        { role: "system", content: "JSON" },
        { role: "user", content: _source },
      ],
    },
    config,
    reserve,
    (value) => (value as { suggestions: unknown[] }).suggestions,
    fetcher,
  );
const success = (content: unknown = { suggestions: [item] }) =>
  Response.json({
    model: QWEN_MODEL,
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(content) } },
    ],
  });
describe("server-only Qwen configuration", () => {
  it("requires an explicit supported runtime and defaults to the rollback path", () => {
    expect(config.runtime).toBe("legacy");
    expect(readQwenConfig({ ...env, AI_RUNTIME: "sdk" })!.runtime).toBe("sdk");
    expect(() => readQwenConfig({ ...env, AI_RUNTIME: "unknown" })).toThrow();
  });
  it("defaults to disabled AI and requires explicit enablement, budget, expiry and matching region", () => {
    expect(readQwenConfig({})).toBeUndefined();
    expect(readQwenConfig({ DASHSCOPE_API_KEY: "unused" })).toBeUndefined();
    for (const key of [
      "AI_CALLS_ENABLED",
      "QWEN_REGION",
      "QWEN_BASE_URL",
      "DASHSCOPE_API_KEY",
      "AI_BUDGET_ID",
      "AI_MAX_REQUESTS",
      "AI_BUDGET_EXPIRES_AT",
    ]) {
      expect(() => readQwenConfig({ ...env, [key]: "" })).toThrow();
    }
    expect(config.retries).toBe(0);
    expect(config.model).toBe("qwen3.8-max");
    expect(readQwenConfig({ ...env, QWEN_MODEL: "qwen3.8-flash" })!.model).toBe(
      "qwen3.8-flash",
    );
    expect(() =>
      readQwenConfig({ ...env, QWEN_MODEL: "another-model" }),
    ).toThrow();
    expect(() => readQwenConfig({ ...env, AI_MAX_REQUESTS: "1001" })).toThrow();
    expect(() => readQwenConfig({ ...env, AI_MAX_RETRIES: "2" })).toThrow();
  });
  it.each([
    "http://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "https://dashscope.aliyuncs.com.evil.test/compatible-mode/v1",
    "https://127.0.0.1/compatible-mode/v1",
    "https://user:password@dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope.aliyuncs.com:8443/compatible-mode/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1?key=secret",
    "https://dashscope.aliyuncs.com/compatible-mode/v1#secret",
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "https://a.b.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  ])("rejects unapproved or mismatched destination %s", (url) => {
    expect(() => readQwenConfig({ ...env, QWEN_BASE_URL: url })).toThrow(
      "QWEN_BASE_URL",
    );
  });
  it.each(["cn-beijing", "ap-southeast-1", "us-east-1", "eu-central-1"])(
    "accepts an explicitly supplied dedicated %s endpoint",
    (region) => {
      const c = readQwenConfig({
        ...env,
        QWEN_REGION: region,
        QWEN_BASE_URL: `https://workspace123.${region}.maas.aliyuncs.com/compatible-mode/v1`,
      });
      expect(c!.region).toBe(region);
    },
  );
  it("never reflects rejected secrets in configuration errors", () => {
    const secret = "synthetic\nprivate-value";
    try {
      readQwenConfig({ ...env, DASHSCOPE_API_KEY: secret });
      expect.fail();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
describe("Qwen provider contract without network", () => {
  it("uses the exact configured URL, bearer header and bounded request", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(success());
    const reserve = vi.fn();
    const result = await runModel(source, projects, config, reserve, mock);
    expect(result).toHaveLength(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe(config.baseUrl + "/chat/completions");
    expect(init).toMatchObject({
      redirect: "error",
      method: "POST",
      headers: { Authorization: "Bearer synthetic-test-token" },
    });
  });
  it("retries only a bounded transient response when explicitly configured and counts every attempt", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(success());
    const reserve = vi.fn();
    await runModel(source, projects, { ...config, retries: 1 }, reserve, mock);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("does not retry uncertain network failure and never reflects exception or response secrets", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private synthetic trace"));
    await expect(
      runModel(source, projects, { ...config, retries: 1 }, vi.fn(), mock),
    ).rejects.toMatchObject({ code: "AI_CONNECTION" });
    expect(mock).toHaveBeenCalledTimes(1);
    const auth = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private synthetic trace", { status: 401 }),
      );
    await expect(
      runModel(source, projects, config, vi.fn(), auth),
    ).rejects.not.toThrow("private synthetic trace");
  });
  it("aborts a slow provider without automatically resending", async () => {
    const mock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    await expect(
      runModel(
        source,
        projects,
        { ...config, timeoutMs: 10, retries: 1 },
        vi.fn(),
        mock,
      ),
    ).rejects.toMatchObject({ code: "AI_CONNECTION" });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("does not reserve or send another call when retry delay exceeds the total time limit", async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 503, headers: { "retry-after": "1" } }),
      );
    const reserve = vi.fn();
    await expect(
      runModel(
        source,
        projects,
        { ...config, timeoutMs: 100, retries: 1 },
        reserve,
        mock,
      ),
    ).rejects.toMatchObject({ code: "AI_CONNECTION" });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("bounds response body reading within the same deadline and cancels the stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":'));
      },
      cancel,
    });
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    const reserve = vi.fn();
    await expect(
      runModel(
        source,
        projects,
        { ...config, timeoutMs: 20, retries: 1 },
        reserve,
        mock,
      ),
    ).rejects.toMatchObject({ code: "AI_CONNECTION" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] },
    {
      choices: [
        {
          finish_reason: "stop",
          message: { content: "{}", tool_calls: [{ function: "write" }] },
        },
      ],
    },
    {
      model: "unrequested-model",
      choices: [
        { finish_reason: "stop", message: { content: '{"suggestions":[]}' } },
      ],
    },
  ])(
    "rejects incomplete, malformed, tool-calling or wrong-model responses %#",
    async (result) => {
      const mock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(result));
      await expect(
        runModel(source, projects, config, vi.fn(), mock),
      ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    },
  );
  it("caps streamed response bytes and refuses retry when no budget remains", async () => {
    const oversized = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(" ".repeat(256001)));
    await expect(
      runModel(source, projects, config, vi.fn(), oversized),
    ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    const mock = vi.fn<typeof fetch>();
    await expect(
      runModel(
        source,
        projects,
        config,
        () => {
          throw new Error("budget exhausted");
        },
        mock,
      ),
    ).rejects.toThrow("budget exhausted");
    expect(mock).not.toHaveBeenCalled();
  });
});
