import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  initialLocale,
  locale,
  setLocale,
  t,
  formatDate,
  formatNumber,
  LOCALE_STORAGE_KEY,
} from "../../apps/web/src/locales";
import { stageLabels, statusLabels } from "../../apps/web/src/locales/en";
import { workspaceTimeZone } from "../../apps/web/src/composables/calendar";
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal("navigator", { language: "en-US" });
  locale.value = "en";
  workspaceTimeZone.value = "UTC";
});
afterEach(() => vi.unstubAllGlobals());
it("prefers an explicit language, otherwise follows supported browser language", () => {
  expect(initialLocale()).toBe("en");
  vi.stubGlobal("navigator", { language: "zh-TW" });
  expect(initialLocale()).toBe("zh-CN");
  saved.set(LOCALE_STORAGE_KEY, "en");
  expect(initialLocale()).toBe("en");
  saved.set(LOCALE_STORAGE_KEY, "invalid");
  expect(initialLocale()).toBe("zh-CN");
});
it("persists valid changes and keeps UI labels reactive without translating user content", () => {
  setLocale("zh-CN");
  expect(saved.get(LOCALE_STORAGE_KEY)).toBe("zh-CN");
  expect(t("Projects")).toBe("项目");
  expect(statusLabels.done).toBe("已完成");
  expect(t("Expand {name}", { name: "Atlas: Done" })).toBe("展开 Atlas: Done");
  expect(t("A user's original source\nAtlas ✓")).toBe(
    "A user's original source\nAtlas ✓",
  );
  setLocale("fr");
  expect(locale.value).toBe("zh-CN");
  setLocale("en");
  expect(stageLabels.potential).toBe("Potential");
});
it("formats dates in the selected language and UTC, and formats numeric parameters", () => {
  setLocale("zh-CN");
  expect(
    formatDate("2026-10-11T23:30:00-04:00", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  ).toContain("12日");
  expect(t("{count} tasks", { count: 1500 })).toBe("1,500 个任务");
  expect(formatNumber(12.5)).toBe("12.5");
  setLocale("en");
  expect(formatDate("2026-10-12T00:00:00Z", { month: "long" })).toBe("October");
  expect(formatDate("not-a-date")).toBe("—");
});
it("keeps session switching usable when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  expect(initialLocale()).toBe("en");
  expect(() => setLocale("zh-CN")).not.toThrow();
  expect(t("Projects")).toBe("项目");
});
it("keeps cached formats correct across language, options and workspace timezone switches", () => {
  const instant = "2026-10-11T16:30:00Z";
  for (const language of ["en", "zh-CN", "en"] as const) {
    setLocale(language);
    const intlLocale = language === "en" ? "en-US" : language;
    for (const timeZone of [
      "UTC",
      "Asia/Shanghai",
      "America/New_York",
      "UTC",
    ]) {
      workspaceTimeZone.value = timeZone;
      const options: Intl.DateTimeFormatOptions = {
        dateStyle: "full",
        timeStyle: "short",
      };
      expect(formatDate(instant, options)).toBe(
        new Intl.DateTimeFormat(intlLocale, { ...options, timeZone }).format(
          new Date(instant),
        ),
      );
      expect(formatDate("2026-10-12", { day: "numeric" })).toBe(
        new Intl.DateTimeFormat(intlLocale, {
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date("2026-10-12")),
      );
      expect(
        formatDate(instant, { hour: "numeric", timeZone: "Europe/London" }),
      ).toBe(
        new Intl.DateTimeFormat(intlLocale, {
          hour: "numeric",
          timeZone: "Europe/London",
        }).format(new Date(instant)),
      );
    }
    const options: Intl.NumberFormatOptions = {
      style: "percent",
      maximumFractionDigits: 2,
    };
    expect(formatNumber(0.12345, options)).toBe(
      new Intl.NumberFormat(intlLocale, options).format(0.12345),
    );
    options.maximumFractionDigits = 0;
    expect(formatNumber(0.12345, options)).toBe(
      new Intl.NumberFormat(intlLocale, options).format(0.12345),
    );
    expect(formatNumber(1500)).toBe(
      new Intl.NumberFormat(intlLocale).format(1500),
    );
  }
});
it("still formats correctly after many configurations and rejects invalid options", () => {
  for (let i = 0; i < 80; i++) {
    const currency = `X${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
    expect(formatNumber(i, { style: "currency", currency })).toBe(
      new Intl.NumberFormat("en-US", { style: "currency", currency }).format(i),
    );
  }
  expect(formatNumber(1500)).toBe("1,500");
  expect(() => formatNumber(1, { style: "currency" })).toThrow(TypeError);
  expect(() => formatDate(new Date(), { timeZone: "invalid-zone" })).toThrow(
    RangeError,
  );
  expect(formatDate("invalid-date")).toBe("—");
});
