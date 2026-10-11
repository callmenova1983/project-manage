import { ref, watch } from "vue";
import { tasksZh } from "./zh-tasks";
import { commonZh } from "./zh-common";
import { editorsZh } from "./zh-editors";
import { activityZh } from "./zh-activity";
export type Locale = "en" | "zh-CN";
export const LOCALE_STORAGE_KEY = "project-manage-locale";
export function initialLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* Preferences still work for this session if storage is unavailable. */
  }
  return typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en";
}
export const locale = ref<Locale>(initialLocale());
export function setLocale(value: string) {
  if (value !== "en" && value !== "zh-CN") return;
  locale.value = value;
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    /* Session preference remains usable. */
  }
}
watch(
  locale,
  (value) => {
    if (typeof document !== "undefined") document.documentElement.lang = value;
  },
  { immediate: true },
);
const chinese: Record<string, string> = {
  ...commonZh,
  ...editorsZh,
  ...activityZh,
  ...tasksZh,
};
/** UI strings only: project names, task text and source material stay untouched. */
export function t(
  key: string,
  params: Record<string, string | number> = {},
): string {
  const message = locale.value === "zh-CN" ? (chinese[key] ?? key) : key;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined
      ? placeholder
      : typeof value === "number"
        ? formatNumber(value)
        : value;
  });
}
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(
    locale.value === "en" ? "en-US" : "zh-CN",
    options,
  ).format(value);
}
export function formatDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale.value === "en" ? "en-US" : "zh-CN", {
    ...options,
    timeZone: "UTC",
  }).format(date);
}
