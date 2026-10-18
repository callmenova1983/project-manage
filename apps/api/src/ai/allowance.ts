import type { QwenConfig } from "./config.js";

export function allowanceReason(
  config: Pick<QwenConfig, "expiresAt" | "maxRequests"> | undefined,
  usedAttempts: number,
  now = Date.now(),
): "disabled" | "expired" | "exhausted" | null {
  if (!config) return "disabled";
  if (now >= config.expiresAt) return "expired";
  if (usedAttempts >= config.maxRequests) return "exhausted";
  return null;
}
