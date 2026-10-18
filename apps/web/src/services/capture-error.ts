const budgetMessages = {
  AI_BUDGET_EXHAUSTED:
    "The approved AI attempt limit has been reached. Ask an administrator to renew the allowance, then retry.",
  AI_BUDGET_EXPIRED:
    "The AI usage approval has expired. Ask an administrator to renew the allowance, then retry.",
  AI_BUDGET:
    "The AI usage approval has expired or its attempt limit has been reached. Ask an administrator to review the allowance, then retry.",
} as const;

const aiMessages: Record<string, string> = {
  ...budgetMessages,
  AI_DISABLED:
    "AI recognition is not enabled. Ask an administrator to check the AI settings.",
  AI_BUSY:
    "Another AI request is running in this workspace. Wait for it to finish, then retry.",
  AI_PENDING:
    "The previous AI request is pending or was interrupted. No duplicate request was sent. Ask an administrator to check its status before retrying.",
  AI_CONNECTION:
    "AI recognition timed out or could not connect. This attempt may have been counted; check its status before retrying.",
  AI_CONFIGURATION:
    "The AI service rejected the configuration. Ask an administrator to check the model and access settings.",
  AI_PROVIDER:
    "The AI service is temporarily unavailable or rate-limited. Check the attempt allowance before retrying.",
  AI_INVALID_OUTPUT:
    "The AI result could not be read reliably. No recognition result was applied; review the input before retrying.",
  AI_INPUT_LIMIT:
    "This content exceeds the AI recognition limit. Split it into smaller batches and retry.",
  AI_STALE:
    "The workspace changed during AI recognition. Refresh the related information and review the input again.",
  AI_INTERNAL:
    "AI recognition could not finish. Keep the input and ask an administrator to check the request before retrying.",
};

const legacyBudgetMessages = new Set([
  "The approved AI attempt budget is exhausted or expired.",
  "Qwen budget is exhausted or expired. Ask the server administrator to review it.",
]);
const legacyMessages: Record<string, string> = {
  "The approved AI allowance has expired. Ask an administrator to extend its validity.":
    budgetMessages.AI_BUDGET_EXPIRED,
  "The approved AI allowance has been used up. Ask an administrator to review the total request limit.":
    budgetMessages.AI_BUDGET_EXHAUSTED,
};

function message(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Changes could not be saved";
}

/** Keep unknown server errors visible; only known AI codes receive UI wording. */
export function captureErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && Object.hasOwn(aiMessages, code))
      return aiMessages[code]!;
  }
  const text = message(error);
  return legacyBudgetMessages.has(text)
    ? budgetMessages.AI_BUDGET
    : Object.hasOwn(legacyMessages, text)
      ? legacyMessages[text]!
      : text;
}

export function isCaptureBudgetError(error: unknown): boolean {
  const text = captureErrorMessage(error);
  return Object.values(budgetMessages).some((value) => value === text);
}
