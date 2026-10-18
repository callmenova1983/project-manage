import { translationInstruction } from './instructions.js';
import { z } from "zod";
import {
  hasHan,
  type MapTranslation,
} from "../../../../packages/domain/map-translation.js";
import type { QwenConfig } from "./config.js";
import { AiError } from "./provider.js";

export function makeMapTranslationRequest(texts: string[], config: QwenConfig) {
  return {
    model: config.model,
    stream: false,
    enable_thinking: false,
    enable_search: false,
    response_format: { type: "json_object" },
    max_tokens: config.maxTokens,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          translationInstruction,
      },
      { role: "user", content: JSON.stringify({ texts }) },
    ],
  };
}

export function validateMapTranslation(
  value: unknown,
  texts: string[],
): MapTranslation {
  const parsed = z
    .object({ translations: z.array(z.string().trim().min(1).max(16000)) })
    .strict()
    .safeParse(value);
  if (
    !parsed.success ||
    parsed.data.translations.length !== texts.length ||
    parsed.data.translations.some(hasHan)
  )
    throw new AiError(
      502,
      "AI_INVALID_OUTPUT",
      "English translation was incomplete. Original project data is unchanged.",
    );
  return parsed.data;
}
