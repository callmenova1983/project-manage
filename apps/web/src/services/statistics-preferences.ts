import { z } from "zod";
import {
  statisticsQuerySchema,
  defaultStatisticsQuery,
  type StatisticsQuery,
} from "../../../../packages/domain/statistics-query";
const saved = z
  .object({
    name: z.string().trim().min(1).max(40),
    query: statisticsQuerySchema,
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    lastView: z.enum(["projects", "tasks"]).default("projects"),
    projects: statisticsQuerySchema,
    tasks: statisticsQuerySchema,
    views: z
      .array(saved)
      .max(10)
      .refine(
        (items) => new Set(items.map((i) => i.name)).size === items.length,
      ),
  })
  .strict();
export type StatisticsPreferences = z.infer<typeof schema>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function defaultStatisticsPreferences(): StatisticsPreferences {
  return {
    version: 1,
    lastView: "projects",
    projects: defaultStatisticsQuery(),
    tasks: { ...defaultStatisticsQuery(), view: "tasks" },
    views: [],
  };
}
export function readStatisticsPreferences(storage: StorageLike, key: string) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { value: defaultStatisticsPreferences(), error: "" };
    if (raw.length > 100000) throw new Error("too large");
    return { value: schema.parse(JSON.parse(raw)), error: "" };
  } catch {
    return {
      value: defaultStatisticsPreferences(),
      error: "无法读取统计设置，原设置已保留，本次更改不会覆盖它。",
    };
  }
}
export function writeStatisticsPreferences(
  storage: StorageLike,
  key: string,
  value: StatisticsPreferences,
) {
  const current = readStatisticsPreferences(storage, key);
  if (current.error) return current.error;
  try {
    storage.setItem(key, JSON.stringify(schema.parse(value)));
    return "";
  } catch {
    return "设置无法保存；仍可继续使用统计页面。";
  }
}
/** Complete query in one URL parameter: a recipient's remembered filters cannot leak in. */
export function statisticsLinkQuery(query: StatisticsQuery) {
  return {
    tab: "statistics",
    statistics: JSON.stringify(statisticsQuerySchema.parse(query)),
  };
}
export function parseStatisticsLink(raw: unknown) {
  try {
    if (typeof raw !== "string" || raw.length > 20000)
      throw new Error("invalid");
    return { query: statisticsQuerySchema.parse(JSON.parse(raw)), error: "" };
  } catch {
    return { query: null, error: "链接中的统计条件无效，请清除条件重新查看。" };
  }
}
