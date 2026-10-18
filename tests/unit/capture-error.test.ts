import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpApi, ApiError } from "../../apps/web/src/services/api";
import {
  captureErrorMessage,
  isCaptureBudgetError,
} from "../../apps/web/src/services/capture-error";
import { locale, t } from "../../apps/web/src/locales";

vi.mock("../../apps/web/src/services/mode", () => ({ browserDemo: false }));

const previousLocale = locale.value;
afterEach(() => {
  vi.unstubAllGlobals();
  locale.value = previousLocale;
});

describe("capture failure recovery", () => {
  it.each([
    ["AI_BUDGET_EXPIRED", "AI 调用授权已过期"],
    ["AI_BUDGET_EXHAUSTED", "本次 AI 调用次数已用完"],
    ["AI_BUDGET", "AI 调用授权已过期或本次调用次数已用完"],
  ])(
    "keeps %s actionable and localized without exposing raw service text",
    (code, expected) => {
      const error = new ApiError(
        "Opaque provider wording",
        429,
        undefined,
        undefined,
        code,
      );
      locale.value = "zh-CN";
      const message = captureErrorMessage(error);
      expect(t(message)).toContain(expected);
      expect(t(message)).toContain("管理员");
      expect(t(message)).not.toContain("Opaque provider wording");
      expect(isCaptureBudgetError(error)).toBe(true);
      expect(isCaptureBudgetError(message)).toBe(true);
    },
  );

  it("recognizes old budget failures even when old servers omit the code", () => {
    locale.value = "zh-CN";
    for (const message of [
      "The approved AI attempt budget is exhausted or expired.",
      "Qwen budget is exhausted or expired. Ask the server administrator to review it.",
    ]) {
      expect(isCaptureBudgetError(new Error(message))).toBe(true);
      expect(t(captureErrorMessage(new Error(message)))).toContain("管理员");
      expect(t(message)).not.toBe(message);
    }
  });

  it("does not disguise unrelated errors as an allowance problem", () => {
    const error = new ApiError(
      "Attachment no longer exists",
      404,
      undefined,
      undefined,
      "NOT_FOUND",
    );
    expect(captureErrorMessage(error)).toBe(error.message);
    expect(isCaptureBudgetError(error)).toBe(false);
    expect(
      captureErrorMessage(
        new ApiError("__proto__", 500, undefined, undefined, "toString"),
      ),
    ).toBe("__proto__");
    locale.value = "zh-CN";
    expect(
      t(
        captureErrorMessage(
          new ApiError(
            "Opaque busy wording",
            409,
            undefined,
            undefined,
            "AI_BUSY",
          ),
        ),
      ),
    ).toBe("工作区正在处理另一个 AI 请求，请等待完成后重试。");
  });

  it("preserves server error codes across the HTTP boundary without retrying", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: "AI_BUDGET_EXPIRED", message: "Opaque service wording" },
          { status: 429 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const source = {
      text: "保留这段输入",
      materialIds: ["beadf32f-c3f0-4e26-af08-70481dff4ec8"],
    };
    await expect(new HttpApi().analyzeCapture(source)).rejects.toMatchObject({
      status: 429,
      code: "AI_BUDGET_EXPIRED",
      message: "Opaque service wording",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
      ...source,
      externalProcessingConfirmed: true,
    });
    expect(source).toEqual({
      text: "保留这段输入",
      materialIds: ["beadf32f-c3f0-4e26-af08-70481dff4ec8"],
    });
  });
});
