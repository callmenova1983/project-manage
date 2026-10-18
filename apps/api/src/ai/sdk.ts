import { createAlibaba } from "@ai-sdk/alibaba";
import { generateText, Output, tool, isStepCount, type ModelMessage } from "ai";
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
  sdkProjectLookup: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        aliases: z.array(z.string()),
      }),
    )
    .optional(),
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
  invoke: (request: unknown, allowLookup: boolean) => Promise<unknown>,
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
        calls++;
        if (calls > (parsed.sdkProjectLookup ? 2 : 1))
          throw new AiError(
            502,
            "AI_INVALID_OUTPUT",
            "Model step limit exceeded.",
          );
        return Response.json(
          await invoke(body, !!parsed.sdkProjectLookup && calls === 1),
        );
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
      output: Output.json(),
      ...(parsed.sdkProjectLookup
        ? {
            tools: {
              searchProjects: tool({
                description:
                  "Find current-workspace project IDs by source-supported name fragments. Read-only.",
                inputSchema: z
                  .object({
                    names: z
                      .array(z.string().trim().min(2).max(100))
                      .min(1)
                      .max(5),
                  })
                  .strict(),
                execute: async ({ names }) =>
                  names.map((name) => {
                    const matches = parsed.sdkProjectLookup!.filter((project) =>
                      [project.name, ...project.aliases].some((label) =>
                        label
                          .toLocaleLowerCase()
                          .includes(name.toLocaleLowerCase()),
                      ),
                    );
                    return {
                      name,
                      total: matches.length,
                      projects: matches.slice(0, 10),
                    };
                  }),
              }),
            },
            stopWhen: isStepCount(2),
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber > 0 ? { toolChoice: "none" as const } : {},
          }
        : {}),
      maxRetries: 0,
      maxOutputTokens: Math.min(
        parsed.max_tokens ?? config.maxTokens,
        config.maxTokens,
      ),
      temperature: parsed.temperature ?? 0.2,
      providerOptions: { alibaba: { enableThinking: false } },
    });
    return validate(result.output);
  } catch {
    if (transportFailure) throw transportFailure;
    throw new AiError(
      502,
      "AI_INVALID_OUTPUT",
      "Qwen returned incomplete or invalid suggestions. Nothing was applied.",
    );
  }
}
