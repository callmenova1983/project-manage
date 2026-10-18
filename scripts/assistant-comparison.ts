import { z } from "zod";

const sample = z
  .object({
    id: z.string().min(1),
    durationMs: z.number().positive().finite(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    passed: z.boolean(),
    criticalErrors: z.number().int().nonnegative(),
  })
  .strict();
export const comparisonRun = z
  .object({
    model: z.string().min(1),
    corpusHash: z.string().regex(/^[a-f0-9]{64}$/),
    inputKind: z.enum(["text", "ocr", "voice"]),
    actualModel: z.boolean(),
    samples: z.array(sample).min(1),
  })
  .strict();

/** Compare recorded runs only; this module never calls a model or writes data.
 * The caller must supply independently captured corpus hashes and timings. */
export function compareAssistantRuns(baseline: unknown, candidate: unknown) {
  const before = comparisonRun.parse(baseline);
  const after = comparisonRun.parse(candidate);
  const missing: string[] = [];
  if (!before.actualModel || !after.actualModel)
    missing.push("real-model-runs-required");
  if (before.samples.some((item) => !item.passed || item.criticalErrors > 0))
    missing.push("invalid-functional-baseline");
  if (before.model !== after.model) missing.push("model-mismatch");
  if (before.corpusHash !== after.corpusHash) missing.push("corpus-mismatch");
  if (before.inputKind !== after.inputKind) missing.push("input-kind-mismatch");
  const ids = (run: typeof before) => run.samples.map((item) => item.id).sort();
  if (
    [before, after].some((run) => new Set(ids(run)).size !== run.samples.length)
  )
    missing.push("duplicate-sample-ids");
  if (JSON.stringify(ids(before)) !== JSON.stringify(ids(after)))
    missing.push("sample-set-mismatch");
  // At least twenty matched observations are needed to resolve a 95th percentile.
  if (Math.min(before.samples.length, after.samples.length) < 20)
    missing.push("insufficient-samples");
  const p95 = (run: typeof before) => {
    const values = run.samples
      .map((item) => item.durationMs)
      .sort((a, b) => a - b);
    return values[Math.ceil(values.length * 0.95) - 1]!;
  };
  const averageTokens = (run: typeof before) => {
    if (
      run.samples.some(
        (item) => item.inputTokens === null || item.outputTokens === null,
      )
    )
      return null;
    return (
      run.samples.reduce(
        (sum, item) => sum + item.inputTokens! + item.outputTokens!,
        0,
      ) / run.samples.length
    );
  };
  const oldTokens = averageTokens(before),
    newTokens = averageTokens(after);
  if (oldTokens === null || newTokens === null)
    missing.push("unknown-token-usage");
  if (oldTokens === 0) missing.push("zero-token-baseline");
  const latencyRatio = p95(after) / p95(before);
  const tokenRatio =
    oldTokens && newTokens !== null ? newTokens / oldTokens : null;
  const failures: string[] = [];
  if (after.samples.some((item) => !item.passed))
    failures.push("functional-failure");
  if (after.samples.some((item) => item.criticalErrors > 0))
    failures.push("critical-business-error");
  // Current agreed performance budgets apply to ordinary text only.
  if (after.inputKind === "text") {
    if (latencyRatio > 1.1 + Number.EPSILON)
      failures.push("latency-budget-exceeded");
    if (tokenRatio !== null && tokenRatio > 1.2 + Number.EPSILON)
      failures.push("token-budget-exceeded");
  } else missing.push("non-text-budget-not-defined");
  return {
    status: missing.length
      ? "incomplete"
      : failures.length
        ? "failed"
        : "passed",
    missing,
    failures,
    sampleCount: after.samples.length,
    baselineP95Ms: p95(before),
    candidateP95Ms: p95(after),
    latencyRatio,
    baselineAverageTokens: oldTokens,
    candidateAverageTokens: newTokens,
    tokenRatio,
  };
}
