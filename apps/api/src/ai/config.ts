export const QWEN_MODEL = "qwen3.8-max";
export const regions = [
  "cn-beijing",
  "ap-southeast-1",
  "us-east-1",
  "eu-central-1",
] as const;
export type QwenRegion = (typeof regions)[number];
export interface QwenConfig {
  runtime?: "legacy" | "sdk";
  region: QwenRegion;
  baseUrl: string;
  apiKey: string;
  model: string;
  budgetId: string;
  maxRequests: number;
  expiresAt: number;
  timeoutMs: number;
  maxTokens: number;
  retries: number;
}
function invalid(field: string): never {
  // Never include the submitted value (especially secrets) in errors.
  throw new Error(`Invalid or missing server AI configuration: ${field}`);
}
export function readAiRuntime(
  env: Record<string, string | undefined>,
): "legacy" | "sdk" {
  const runtime = env.AI_RUNTIME ?? "legacy";
  if (runtime !== "legacy" && runtime !== "sdk") invalid("AI_RUNTIME");
  return runtime;
}
export function readQwenConfig(
  env: Record<string, string | undefined>,
): QwenConfig | undefined {
  const provider = env.AI_PROVIDER ?? "rules";
  if (provider === "rules") return undefined;
  if (provider !== "qwen") invalid("AI_PROVIDER");
  const runtime = readAiRuntime(env);
  if (env.AI_CALLS_ENABLED !== "true") invalid("AI_CALLS_ENABLED");
  const region = env.QWEN_REGION as QwenRegion;
  if (!regions.includes(region)) invalid("QWEN_REGION");
  const rawUrl = env.QWEN_BASE_URL ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    invalid("QWEN_BASE_URL");
  }
  const shared: Partial<Record<QwenRegion, string>> = {
    "cn-beijing": "dashscope.aliyuncs.com",
    "ap-southeast-1": "dashscope-intl.aliyuncs.com",
    "us-east-1": "dashscope-us.aliyuncs.com",
  };
  const suffix = `.${region}.maas.aliyuncs.com`;
  const workspace = url.hostname.endsWith(suffix)
    ? url.hostname.slice(0, -suffix.length)
    : "";
  const dedicated =
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(workspace) &&
    !["trial", "token-plan"].includes(workspace);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !["/compatible-mode/v1", "/compatible-mode/v1/"].includes(url.pathname) ||
    !(url.hostname === shared[region] || dedicated)
  )
    invalid("QWEN_BASE_URL");
  if (env.QWEN_MODEL && !/^qwen[a-z0-9._-]{0,99}$/.test(env.QWEN_MODEL))
    invalid("QWEN_MODEL");
  const apiKey = env.DASHSCOPE_API_KEY ?? "";
  if (!apiKey || apiKey.length > 1024 || /\s/.test(apiKey))
    invalid("DASHSCOPE_API_KEY");
  const budgetId = env.AI_BUDGET_ID ?? "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(budgetId)) invalid("AI_BUDGET_ID");
  const number = (key: string, min: number, max: number, fallback?: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (
      value === undefined ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    )
      invalid(key);
    return value;
  };
  const expiresAt = Date.parse(env.AI_BUDGET_EXPIRES_AT ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
    invalid("AI_BUDGET_EXPIRES_AT");
  return {
    runtime,
    region,
    baseUrl: url.href.replace(/\/$/, ""),
    apiKey,
    model: env.QWEN_MODEL ?? QWEN_MODEL,
    budgetId,
    expiresAt,
    maxRequests: number("AI_MAX_REQUESTS", 1, 1000),
    timeoutMs: number("AI_TIMEOUT_MS", 1000, 30000, 15000),
    maxTokens: number("AI_MAX_OUTPUT_TOKENS", 512, 4096, 2048),
    retries: number("AI_MAX_RETRIES", 0, 1, 0),
  };
}
