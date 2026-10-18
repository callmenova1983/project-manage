import { captureInstruction } from './instructions.js';
import {
  assembleCaptureText,
  captureAnalysisOutput,
  type CaptureAnalysis,
  type CaptureRecognitionDepth,
} from "../../../../packages/domain/capture.js";
import type { ParsedMaterial } from "../progress-materials.js";
import type { QwenConfig } from "./config.js";
import { AiError } from "./provider.js";

export function localCaptureAnalysis(
  text: string,
  materials: (ParsedMaterial & { name?: string })[],
): CaptureAnalysis {
  const source = assembleCaptureText(text, materials);
  if (!source)
    throw new AiError(
      400,
      "CAPTURE_TEXT_UNAVAILABLE",
      "未提取到文字。当前为“仅文字”模式；截图、扫描件或图片内容请切换“识别图中文字”或“理解图表”，也可以直接粘贴文字。原始附件已保留。",
    );
  if (source.length > 20000)
    throw new AiError(
      400,
      "AI_INPUT_LIMIT",
      "提取的文字超过 20000 字符，请拆分录入；原始附件已保留。",
    );
  return {
    text: source,
    uncertainties: materials.some((material) => material.images.length)
      ? ["仅提取了可读取的文字，附件中的图片未识别；需要时可切换识别深度。"]
      : [],
    model: "local-text",
  };
}

export function makeCaptureRequest(
  text: string,
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
          captureInstruction(recognitionDepth),
      },
      {
        role: "user",
        content: [
          { type: "text", text: JSON.stringify({ notes: text, documentText }) },
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ],
  };
}
export const validateCaptureAnalysis = (value: unknown) =>
  captureAnalysisOutput.parse(value);
