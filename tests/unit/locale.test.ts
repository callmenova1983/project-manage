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
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  vi.stubGlobal("navigator", { language: "en-US" });
  locale.value = "en";
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
