import { expect, it, vi } from "vitest";
import { generateJson } from "../../apps/api/src/ai/provider";
import type { QwenConfig } from "../../apps/api/src/ai/config";
import { createSeed } from "../../packages/domain/seed";
import {
  makeCaptureRequest,
  validateCaptureAnalysis,
} from "../../apps/api/src/ai/capture";
import {
  makeProgressRequest,
  validateProgressAnalysis,
} from "../../apps/api/src/ai/progress";
import {
  makeTaskReviewRequest,
  validateTaskReview,
} from "../../apps/api/src/ai/task-review";
import {
  makeReferenceRequest,
  validateReferenceClassification,
} from "../../apps/api/src/ai/capture-reference";
import {
  makeProjectLocationRequest,
  validateProjectLocationAnalysis,
} from "../../apps/api/src/ai/project-location";
import {
  makeMapTranslationRequest,
  validateMapTranslation,
} from "../../apps/api/src/ai/map-translation";

const config: QwenConfig = {
  runtime: "sdk",
  model: "qwen-test",
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic",
  budgetId: "scenarios",
  maxRequests: 10,
  expiresAt: Date.now() + 60000,
  timeoutMs: 1000,
  maxTokens: 4096,
  retries: 0,
};
const seed = createSeed(),
  project = seed.projects[0]!,
  task = seed.tasks[0]!;
const files = [{ id: "11111111-1111-4111-8111-111111111111", name: "报价.pdf" }];
const cases: {
  name: string;
  request: unknown;
  output: unknown;
  validate: (value: unknown) => unknown;
  limit: number;
}[] = [
  {
    name: "capture",
    request: makeCaptureRequest("记录", [], config, "ocr"),
    output: { text: "记录", uncertainties: [] },
    validate: validateCaptureAnalysis,
    limit: 4096,
  },
  {
    name: "progress",
    request: makeProgressRequest("记录", project, [], config),
    output: { summary: "记录", recognizedText: "", uncertainties: [] },
    validate: validateProgressAnalysis,
    limit: 4096,
  },
  {
    name: "task review",
    request: makeTaskReviewRequest(task, config),
    output: { questions: [] },
    validate: (value) => validateTaskReview(value, task),
    limit: 4096,
  },
  {
    name: "reference",
    request: makeReferenceRequest("报价.pdf", config),
    output: {
      files: [{ id: "11111111-1111-4111-8111-111111111111", category: "quote", projectId: project.id }],
    },
    validate: (value) =>
      validateReferenceClassification(value, files, [project]),
    limit: 1024,
  },
  {
    name: "location",
    request: makeProjectLocationRequest(project, config),
    output: { candidates: [] },
    validate: (value) => validateProjectLocationAnalysis(value, project),
    limit: 1200,
  },
  {
    name: "translation",
    request: makeMapTranslationRequest(["项目"], config),
    output: { translations: ["Project"] },
    validate: (value) => validateMapTranslation(value, ["项目"]),
    limit: 4096,
  },
];
it.each(cases)(
  "preserves $name validation and request-specific limits through SDK",
  async ({ request, output, validate, limit }) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          model: config.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: JSON.stringify(output) },
            },
          ],
        }),
      );
    expect(
      await generateJson(request, config, vi.fn(), validate, fetcher),
    ).toEqual(validate(output));
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body.max_tokens).toBe(limit);
    expect(body.enable_thinking).toBe(false);
    expect(body.enable_search).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it.each(cases)(
  "rejects malformed $name output without a hidden retry",
  async ({ request, validate }) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          model: config.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"unsupported":true}' },
            },
          ],
        }),
      );
    await expect(
      generateJson(request, config, vi.fn(), validate, fetcher),
    ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
