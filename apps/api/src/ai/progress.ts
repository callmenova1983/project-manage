import { progressInstruction } from './instructions.js';
import type { Project } from "../../../../packages/domain/types.js";
import { progressAnalysisOutput } from "../../../../packages/domain/progress-material.js";
import { AiError } from "./provider.js";
import type { QwenConfig } from "./config.js";
import type { ParsedMaterial } from "../progress-materials.js";
import type { CaptureRecognitionDepth } from "../../../../packages/domain/capture.js";
export function makeProgressRequest(
  text: string,
  project: Project,
  materials: ParsedMaterial[],
  config: QwenConfig,
  recognitionDepth: CaptureRecognitionDepth = "text",
) {
  const documentText = materials.map((m) => m.text).join("\n\n"),
    images =
      recognitionDepth === "text" ? [] : materials.flatMap((m) => m.images);
  if (text.length + documentText.length > 24000 || images.length > 6)
    throw new AiError(
      400,
      "AI_INPUT_LIMIT",
      "Use up to 24000 source characters and 6 images. Split the documents.",
    );
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
          progressInstruction(recognitionDepth),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              project: { name: project.name, aliases: project.aliases },
              notes: text,
              documentText,
            }),
          },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ],
  };
}
export const validateProgressAnalysis = (value: unknown) =>
  progressAnalysisOutput.parse(value);
