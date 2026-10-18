import { uiEnglish } from "./ui-en";
import { workbenchZh } from "./zh-workbench";
import { projectDetailZh } from "./zh-project-detail";
import { taskExperienceZh } from "./zh-task-experience";
import { projectMapZh } from "./zh-project-map";
import { projectLocationZh } from "./zh-project-location";
import { timeZoneZh } from "./zh-time-zone";
import { multiViewZh } from "./zh-multi-view";
import { personalWorkZh } from "./zh-personal-work";
import { workspaceTimeZone } from "../composables/calendar";
import { ref, watch } from "vue";
import { tasksZh } from "./zh-tasks";
import { commonZh } from "./zh-common";
import { editorsZh } from "./zh-editors";
import { activityZh } from "./zh-activity";
import { intakeZh } from "./zh-intake";
import { adminZh } from "./zh-admin";
import { workspaceZh } from "./zh-workspace";
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
  ...personalWorkZh,
  ...timeZoneZh,
  ...editorsZh,
  ...activityZh,
  ...tasksZh,
  ...intakeZh,
  ...adminZh,
  ...workspaceZh,
  ...multiViewZh,
  ...projectDetailZh,
  ...projectMapZh,
  ...projectLocationZh,
  ...taskExperienceZh,
  ...workbenchZh,
};
// Support both existing English keys and explicitly registered Chinese UI keys.
// UI translation is opt-in at each call site; no data or DOM text is rewritten.
const english: Record<string, string> = Object.fromEntries(
  Object.entries(chinese).map(([key, value]) => [value, key]),
);
Object.assign(english, uiEnglish);
for (const [zh, en] of Object.entries(uiEnglish)) {
  chinese[en] ??= zh;
}

// Match only complete, registered system messages, including interpolated
// errors returned by services. Inserted project names and source text stay intact.
const uiPatterns = Object.entries(uiEnglish).flatMap(([zh, en]) => {
  if (
    !/\{\w+\}/.test(zh) ||
    (zh.replace(/\{\w+\}/g, "").match(/[\p{Script=Han}]/gu)?.length ?? 0) < 4
  )
    return [];
  return [
    [zh, en],
    [en, zh],
  ].map(([source, target], direction) => {
    const names: string[] = [];
    const parts = source!.split(/(\{\w+\})/g);
    const pattern = parts
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1));
          return "([\\s\\S]*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return {
      language: direction === 0 ? "en" : "zh-CN",
      pattern: new RegExp("^" + pattern + "$"),
      names,
      target: target!,
      prefix: parts[0]!,
    };
  });
});
function systemMessage(key: string): string | undefined {
  for (const entry of uiPatterns) {
    if (entry.language !== locale.value || !key.startsWith(entry.prefix))
      continue;
    const match = entry.pattern.exec(key);
    if (!match) continue;
    const values = Object.fromEntries(
      entry.names.map((name, i) => [name, match[i + 1]!]),
    );
    return entry.target.replace(
      /\{(\w+)\}/g,
      (placeholder, name: string) => values[name] ?? placeholder,
    );
  }
  return undefined;
}

// Format configuration only: never retain project/task values or rendered strings.
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
function formatter<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const cached = cache.get(key);
  if (cached) return cached;
  const value = create();
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
function formatKey(language: string, options: object = {}) {
  return JSON.stringify([
    language,
    Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
/** UI strings only: project names, task text and source material stay untouched. */
export function t(
  key: string,
  params: Record<string, string | number> = {},
): string {
  const message =
    locale.value === "zh-CN"
      ? (chinese[key] ?? systemMessage(key) ?? key)
      : (english[key] ??
        english[key.replace(/\s+/g, " ").trim()] ??
        systemMessage(key) ??
        key);
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
  const language = locale.value === "en" ? "en-US" : "zh-CN";
  return formatter(
    numberFormats,
    formatKey(language, options),
    () => new Intl.NumberFormat(language, options),
  ).format(value);
}
export function formatDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const language = locale.value === "en" ? "en-US" : "zh-CN";
  const resolved = {
    ...options,
    timeZone:
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? "UTC"
        : (options.timeZone ?? workspaceTimeZone.value),
  };
  return formatter(
    dateFormats,
    formatKey(language, resolved),
    () => new Intl.DateTimeFormat(language, resolved),
  ).format(date);
}
