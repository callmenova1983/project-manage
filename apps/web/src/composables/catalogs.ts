import { computed, shallowRef } from "vue";
import {
  defaultCatalogs,
  type Catalogs,
} from "../../../../packages/domain/admin";
import { locale } from "../locales";
export const catalogs = shallowRef<Catalogs>(structuredClone(defaultCatalogs));
export function setCatalogs(value?: Catalogs) {
  catalogs.value = value ?? structuredClone(defaultCatalogs);
}
export const stageIds = computed(() =>
  [...catalogs.value.stages].sort((a, b) => a.order - b.order).map((s) => s.id),
);
export const activeStages = computed(() =>
  catalogs.value.stages
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order),
);
export const activeCategories = computed(() =>
  catalogs.value.categories
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order),
);
export function catalogLabel(kind: "stages" | "categories", id: string) {
  if (kind === "stages" && id === "unclassified")
    return locale.value === "zh-CN" ? "阶段待补" : "Stage to complete";
  const entry = catalogs.value[kind].find((s) => s.id === id);
  return entry ? (locale.value === "zh-CN" ? entry.zh : entry.en) : id;
}
const tokens = {
  purple: "in-progress",
  blue: "approved",
  green: "done",
  amber: "blocked",
  rose: "proposal",
  neutral: "todo",
};
export function stageColors(id: string) {
  const c = catalogs.value.stages.find((s) => s.id === id)?.color ?? "neutral";
  const prefix = c === "blue" || c === "rose" ? "stage" : "status";
  const token = tokens[c];
  return {
    color: `var(--${prefix}-${token})`,
    background: `var(--${prefix}-${token}-bg)`,
    borderColor: `var(--${prefix}-${token}-border)`,
  };
}
