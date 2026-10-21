import { createAlibaba } from "@ai-sdk/alibaba";
import { generateText, Output, jsonSchema, type ModelMessage } from "ai";
import { z } from "zod";
import type { QwenConfig } from "./config.js";
import { AiError } from "./provider.js";

const part = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/),
    }),
  }),
]);
const input = z.object({
  sdkOutputSchema: z.record(z.string(), z.unknown()).optional(),
  messages: z.array(
    z.union([
      z.object({ role: z.literal("system"), content: z.string() }),
      z.object({
        role: z.literal("user"),
        content: z.union([z.string(), z.array(part)]),
      }),
    ]),
  ),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
});

/** SDK owns model messages/output; the existing guarded transport owns actual
 * HTTP attempts, budgeting, timeouts, response limits and factual usage. SDK
 * retries are disabled so one retry cannot silently become several attempts. */
export async function generateSdkJson<T>(
  request: unknown,
  config: QwenConfig,
  validate: (value: unknown) => T,
  invoke: (request: unknown) => Promise<unknown>,
): Promise<T> {
  const parsed = input.parse(request);
  const messages: ModelMessage[] = parsed.messages
    .filter((message) => message.role === "user")
    .map((message) => {
      if (typeof message.content === "string") return message as ModelMessage;
      return {
        role: "user",
        content: message.content.map((item) =>
          item.type === "text"
            ? { type: "text", text: item.text }
            : {
                type: "file",
                data: new URL(item.image_url.url),
                mediaType: item.image_url.url.slice(
                  5,
                  item.image_url.url.indexOf(";"),
                ),
              },
        ),
      };
    });
  let transportFailure: unknown;
  let calls = 0;
  const provider = createAlibaba({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    fetch: async (_url, init) => {
      try {
        const body = JSON.parse(String(init?.body));
        // No search or automatic external tools in existing structured flows.
        body.enable_search = false;
        if (body.response_format?.type === "json_schema")
          body.response_format.json_schema.strict = true;
        calls++;
        if (calls > 1)
          throw new AiError(
            502,
            "AI_INVALID_OUTPUT",
            "Model step limit exceeded.",
          );
        return Response.json(await invoke(body));
      } catch (error) {
        transportFailure = error;
        throw error;
      }
    },
  });
  try {
    const result = await generateText({
      model: provider(config.model),
      messages,
      instructions: parsed.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n"),
      output: parsed.sdkOutputSchema
        ? Output.object({ schema: jsonSchema(parsed.sdkOutputSchema) })
        : Output.json(),
      maxRetries: 0,
      maxOutputTokens: Math.min(
        parsed.max_tokens ?? config.maxTokens,
        config.maxTokens,
      ),
      temperature: parsed.temperature ?? 0.2,
      providerOptions: { alibaba: { enableThinking: false } },
    });
    return validate(result.output);
  } catch (error) {
    if (transportFailure) throw transportFailure;
    if (error instanceof AiError) throw error;
    throw new AiError(
      502,
      "AI_INVALID_OUTPUT",
      "Qwen returned incomplete or invalid suggestions. Nothing was applied.",
      { stage: "sdk-output", reason: "invalid-json-or-schema" },
    );
  }
}
