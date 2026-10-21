import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import type { QwenConfig } from "./config.js";
export class AiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public diagnostic?: { stage: string; reason: string; paths?: string[] },
  ) {
    super(message);
  }
}
async function boundedJson(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 256000) throw new Error("Response limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function generateJson<T>(
  request: unknown,
  config: QwenConfig,
  reserveAttempt: () => void,
  validate: (value: unknown) => T,
  fetchImpl: typeof fetch = fetch,
  reportUsage?: (usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  }) => void,
): Promise<T> {
  if (config.runtime === "sdk") {
    const deadline = performance.now() + config.timeoutMs;
    const { generateSdkJson } = await import("./sdk.js");
    return generateSdkJson(request, config, validate, (body) =>
      generateLegacyJson(
        body,
        { ...config, timeoutMs: Math.max(0, deadline - performance.now()) },
        reserveAttempt,
        (_value, envelope) => envelope,
        fetchImpl,
        reportUsage,
      ),
    );
  }
  return generateLegacyJson(
    request,
    config,
    reserveAttempt,
    validate,
    fetchImpl,
    reportUsage,
  );
}

async function generateLegacyJson<T>(
  request: unknown,
  config: QwenConfig,
  reserveAttempt: () => void,
  validate: (value: unknown, envelope: unknown) => T,
  fetchImpl: typeof fetch,
  reportUsage?: (usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  }) => void,
): Promise<T> {
  const body = JSON.stringify(request);
  const deadline = performance.now() + config.timeoutMs;
  const timedOut = () =>
    new AiError(
      504,
      "AI_CONNECTION",
      "Qwen could not finish within the request time limit. No additional request was sent; check the attempt budget before trying again.",
    );
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs <= 0) throw timedOut();
    reserveAttempt();
    const signal = AbortSignal.timeout(remainingMs);
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw new AiError(
        504,
        "AI_CONNECTION",
        "Qwen did not finish in time or could not be reached. The attempt may have been billed; no automatic retry was made.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? 0.5 : Number(retryAfter);
      if (
        [429, 503].includes(response.status) &&
        attempt < config.retries &&
        Number.isFinite(seconds) &&
        seconds >= 0 &&
        seconds <= 2
      ) {
        if (seconds * 1000 >= deadline - performance.now()) throw timedOut();
        await delay(seconds * 1000);
        continue;
      }
      if ([401, 403, 404].includes(response.status))
        throw new AiError(
          503,
          "AI_CONFIGURATION",
          "Qwen rejected the server configuration. Ask the administrator to check the model, region and access; credentials are never shown here.",
        );
      throw new AiError(
        503,
        "AI_PROVIDER",
        "Qwen is unavailable or rate-limited. Nothing was applied. Check the attempt budget before starting a new request.",
      );
    }
    try {
      const raw = await boundedJson(response, signal);
      // Valid metering remains factual even when truncated/invalid suggestions are rejected.
      const envelope = z
        .object({ usage: z.unknown().optional() })
        .safeParse(raw);
      const usage = z
        .object({
          prompt_tokens: z.number().int().nonnegative(),
          completion_tokens: z.number().int().nonnegative(),
        })
        .safeParse(envelope.success ? envelope.data.usage : undefined);
      if (usage.success)
        reportUsage?.({
          inputTokens: usage.data.prompt_tokens,
          outputTokens: usage.data.completion_tokens,
        });
      const result = z
        .object({
          model: z.string().optional(),
          usage: z.unknown().optional(),
          choices: z
            .array(
              z.object({
                finish_reason: z.literal("stop"),
                message: z.object({
                  content: z.string().max(200000),
                  tool_calls: z.array(z.unknown()).max(0).nullish(),
                }),
              }),
            )
            .length(1),
        })
        .parse(raw);
      if (result.model && result.model !== config.model)
        throw new Error("Unexpected model");
      return validate(JSON.parse(result.choices[0]!.message.content), raw);
    } catch (error) {
      if (signal.aborted) throw timedOut();
      if (error instanceof AiError) throw error;
      throw new AiError(
        502,
        "AI_INVALID_OUTPUT",
        "Qwen returned incomplete or invalid suggestions. Nothing was applied. Check the attempt budget before trying again.",
        { stage: "provider-output", reason: "invalid-json-or-envelope" },
      );
    }
  }
  throw new AiError(503, "AI_PROVIDER", "Qwen is unavailable.");
}
