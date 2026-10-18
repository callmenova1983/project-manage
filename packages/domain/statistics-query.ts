import { z } from "zod";
export const statisticsQuerySchema = z
  .object({
    view: z.enum(["projects", "tasks"]).default("projects"),
    search: z.string().max(200).default(""),
    projects: z.array(z.string().max(100)).max(500).default([]),
    stages: z.array(z.string().max(100)).max(100).default([]),
    attention: z.enum(["all", "blocked", "overdue"]).default("all"),
    unassigned: z.boolean().default(false),
    preset: z
      .enum(["attention", "projects", "open", "blocked", "overdue", "name"])
      .default("attention"),
    sort: z
      .enum([
        "",
        "name",
        "projects",
        "total",
        "open",
        "done",
        "blocked",
        "overdue",
      ])
      .default(""),
    direction: z.enum(["asc", "desc"]).default("desc"),
    pageSize: z
      .union([z.literal(25), z.literal(50), z.literal(100)])
      .default(25),
    compact: z.boolean().default(false),
    columns: z
      .array(z.enum(["total", "done", "blocked", "overdue"]))
      .default(["total", "done", "blocked", "overdue"]),
  })
  .strict();
export type StatisticsQuery = z.infer<typeof statisticsQuerySchema>;
export const defaultStatisticsQuery = () => statisticsQuerySchema.parse({});
export function readStatisticsQuery(raw: unknown) {
  const parsed = statisticsQuerySchema.safeParse(raw);
  return parsed.success
    ? { query: parsed.data, error: "" }
    : { query: null, error: "统计条件无效，请清除条件后重试。" };
}
