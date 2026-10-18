import { describe, expect, it } from "vitest";
import { compareAssistantRuns } from "../../scripts/assistant-comparison";

const run = () => ({
  model: "test-model",
  corpusHash: "a".repeat(64),
  inputKind: "text",
  actualModel: true,
  samples: Array.from({ length: 20 }, (_, index) => ({
    id: `sample-${index}`,
    durationMs: 100,
    inputTokens: 80 as number | null,
    outputTokens: 20 as number | null,
    passed: true,
    criticalErrors: 0,
  })),
});
describe("assistant performance acceptance from captured runs", () => {
  it("accepts the inclusive text budgets and uses nearest-rank p95", () => {
    const after = run();
    after.samples.forEach((item) => {
      item.durationMs = 110;
      item.outputTokens = 40;
    });
    after.samples[19]!.durationMs = 1000;
    expect(compareAssistantRuns(run(), after)).toMatchObject({
      status: "passed",
      candidateP95Ms: 110,
      tokenRatio: 1.2,
    });
  });
  it("reports both performance regressions", () => {
    const after = run();
    after.samples.forEach((item) => {
      item.durationMs = 111;
      item.outputTokens = 41;
    });
    expect(compareAssistantRuns(run(), after)).toMatchObject({
      status: "failed",
      failures: ["latency-budget-exceeded", "token-budget-exceeded"],
    });
  });
  it("never turns missing usage into zero tokens", () => {
    const after = run();
    after.samples[0]!.inputTokens = null;
    expect(compareAssistantRuns(run(), after)).toMatchObject({
      status: "incomplete",
      tokenRatio: null,
      missing: ["unknown-token-usage"],
    });
  });
  it("does not accept mismatched, duplicated, simulated or insufficient observations", () => {
    const after = run();
    after.model = "other";
    after.actualModel = false;
    after.corpusHash = "b".repeat(64);
    after.samples.pop();
    after.samples[1]!.id = after.samples[0]!.id;
    const result = compareAssistantRuns(run(), after);
    expect(result.status).toBe("incomplete");
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "model-mismatch",
        "real-model-runs-required",
        "corpus-mismatch",
        "duplicate-sample-ids",
        "sample-set-mismatch",
        "insufficient-samples",
      ]),
    );
  });
  it("rejects functional errors even when performance improves", () => {
    const after = run();
    after.samples[0]!.passed = false;
    after.samples[1]!.criticalErrors = 1;
    expect(compareAssistantRuns(run(), after)).toMatchObject({
      status: "failed",
      failures: ["functional-failure", "critical-business-error"],
    });
  });
  it("requires separate budgets for OCR and voice", () => {
    const before = run(),
      after = run();
    before.inputKind = after.inputKind = "ocr";
    expect(compareAssistantRuns(before, after)).toMatchObject({
      status: "incomplete",
      missing: ["non-text-budget-not-defined"],
    });
  });
  it("rejects invalid data and unusable baselines", () => {
    expect(() => compareAssistantRuns({}, run())).toThrow();
    const before = run();
    before.samples[0]!.passed = false;
    expect(compareAssistantRuns(before, run()).missing).toContain(
      "invalid-functional-baseline",
    );
    before.samples.forEach((item) => {
      item.inputTokens = item.outputTokens = 0;
    });
    expect(compareAssistantRuns(before, run()).missing).toContain(
      "zero-token-baseline",
    );
  });
});
