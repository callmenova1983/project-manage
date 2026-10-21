import { expect, it, vi } from "vitest";
import { generateJson } from "../../apps/api/src/ai/provider";
import type { QwenConfig } from "../../apps/api/src/ai/config";
const config: QwenConfig = {
  runtime: "sdk",
  model: "qwen-test",
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "test-key",
  budgetId: "test",
  maxRequests: 3,
  expiresAt: Date.now() + 60000,
  timeoutMs: 1000,
  maxTokens: 512,
  retries: 1,
};
const request = {
  messages: [
    { role: "system", content: "JSON only" },
    { role: "user", content: "test" },
  ],
};
const response = (finish = "stop") =>
  Response.json({
    model: config.model,
    choices: [
      {
        index: 0,
        finish_reason: finish,
        message: { role: "assistant", content: '{"ok":true}' },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
it("uses SDK JSON requests with the guarded transport and actual metering", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  const reserve = vi.fn(),
    usage = vi.fn();
  expect(
    await generateJson(
      request,
      config,
      reserve,
      (value) => value,
      fetcher,
      usage,
    ),
  ).toEqual({ ok: true });
  expect(reserve).toHaveBeenCalledTimes(1);
  expect(usage).toHaveBeenCalledExactlyOnceWith({
    inputTokens: 10,
    outputTokens: 5,
  });
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
  expect(body).toMatchObject({
    model: config.model,
    response_format: { type: "json_object" },
    enable_thinking: false,
    enable_search: false,
  });
  expect(fetcher.mock.calls[0]![1]!.redirect).toBe("error");
});
it("retains the exact retry budget instead of adding SDK retries", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response("", { status: 503, headers: { "retry-after": "0" } }),
    );
  const reserve = vi.fn();
  await expect(
    generateJson(request, config, reserve, (value) => value, fetcher),
  ).rejects.toMatchObject({ code: "AI_PROVIDER" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(reserve).toHaveBeenCalledTimes(2);
});
it("records factual usage while refusing truncated output", async () => {
  const usage = vi.fn(),
    fetcher = vi.fn<typeof fetch>().mockResolvedValue(response("length"));
  await expect(
    generateJson(request, config, vi.fn(), (value) => value, fetcher, usage),
  ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
  expect(usage).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not send a request when quota reservation fails", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const error = new Error("quota");
  await expect(
    generateJson(
      request,
      config,
      () => {
        throw error;
      },
      (value) => value,
      fetcher,
    ),
  ).rejects.toBe(error);
  expect(fetcher).not.toHaveBeenCalled();
});
it("preserves image input and rejects remote image downloads", async () => {
  const imageRequest = (url: string) => ({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "read" },
          { type: "image_url", image_url: { url } },
        ],
      },
    ],
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  const url = "data:image/png;base64,aGVsbG8=";
  await generateJson(
    imageRequest(url),
    config,
    vi.fn(),
    (value) => value,
    fetcher,
  );
  expect(
    JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).messages.find(
      (message: { role: string }) => message.role === "user",
    ).content[1].image_url.url,
  ).toBe(url);
  await expect(
    generateJson(
      imageRequest("https://example.com/image.png"),
      config,
      vi.fn(),
      (value) => value,
      fetcher,
    ),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
