import { z } from "zod";
import { dateSchema, weekKey, type Activity } from "./types.js";
import { isCompletionAction } from "./activity-summary.js";

export const activityQueryInput = z
  .object({
    weekStart: dateSchema
      .refine(
        (v) => weekKey(new Date(v)) === v,
        "Choose a Monday UTC week start",
      )
      .optional(),
    projectIds: z.array(z.string().min(1).max(100)).max(1000).optional(),
    search: z.string().trim().max(200).optional(),
    excludeSeed: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z
      .object({
        scope: z.string().max(110000),
        through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        asOf: z.string().datetime(),
        createdAt: z.string().datetime({ offset: true }),
        id: z.string().min(1).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ActivityQuery = z.infer<typeof activityQueryInput>;
export interface ActivityPage {
  events: Activity[];
  nextCursor: NonNullable<ActivityQuery["cursor"]> | null;
  total: number;
  projectCount: number;
  completionActions: number;
  days: { date: string; count: number }[];
  weekStart: string | null;
  timeZone: "UTC";
  asOf: string;
}
export function activityScope(query: ActivityQuery) {
  return JSON.stringify({
    weekStart: query.weekStart ?? null,
    projectIds: query.projectIds ? [...new Set(query.projectIds)].sort() : null,
    search: query.search?.trim().toLowerCase() ?? "",
    excludeSeed: !!query.excludeSeed,
  });
}
export function matchesActivity(
  activity: Activity,
  query: ActivityQuery,
  asOf: string,
) {
  const at = Date.parse(activity.createdAt);
  const start = query.weekStart
    ? Date.parse(query.weekStart + "T00:00:00Z")
    : -Infinity;
  const search = query.search?.trim().toLowerCase();
  return (
    Number.isFinite(at) &&
    at >= start &&
    (!query.weekStart || at < start + 7 * 86400000) &&
    at <= Date.parse(asOf) &&
    (!query.excludeSeed || activity.source !== "Synthetic demo seed") &&
    (!query.projectIds ||
      (activity.projectId !== null &&
        query.projectIds.includes(activity.projectId))) &&
    (!search ||
      `${activity.actor} ${activity.action} ${activity.source} ${JSON.stringify(activity.after ?? "")}`
        .toLowerCase()
        .includes(search))
  );
}
export function compareActivities(
  a: Pick<Activity, "createdAt" | "id">,
  b: Pick<Activity, "createdAt" | "id">,
) {
  return (
    Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Source is a stable newest-first iterable. Counts scan the full range; only one page is retained. */
export function queryActivities(
  source: Iterable<Activity>,
  query: ActivityQuery,
  through: number,
  now = new Date(),
): ActivityPage {
  activityQueryInput.parse(query);
  const scope = activityScope(query);
  if (query.cursor && query.cursor.scope !== scope)
    throw new Error("Activity filters changed. Reload the first page.");
  const asOf = query.cursor?.asOf ?? now.toISOString();
  if (Date.parse(asOf) > now.getTime())
    throw new Error("History cutoff cannot be in the future");
  const events: Activity[] = [];
  let total = 0;
  const projects = new Set<string>(),
    completions = new Set<string>(),
    seen = new Set<string>();
  const start = query.weekStart
    ? Date.parse(query.weekStart + "T00:00:00Z")
    : 0;
  const days = query.weekStart
    ? Array.from({ length: 7 }, (_, i) => ({
        date: new Date(start + i * 86400000).toISOString().slice(0, 10),
        count: 0,
      }))
    : [];
  const limit = query.limit ?? 25;
  for (const a of source) {
    if (seen.has(a.id) || !matchesActivity(a, query, asOf)) continue;
    seen.add(a.id);
    total++;
    if (a.projectId) projects.add(a.projectId);
    if (days.length)
      days[Math.floor((Date.parse(a.createdAt) - start) / 86400000)]!.count++;
    if (isCompletionAction(a))
      completions.add(`${a.entityId}:${a.before!.version}:${a.after!.version}`);
    if (
      events.length <= limit &&
      (!query.cursor || compareActivities(a, query.cursor) > 0)
    )
      events.push(a);
  }
  const more = events.length > limit;
  if (more) events.pop();
  const last = events.at(-1);
  return {
    events,
    total,
    projectCount: projects.size,
    completionActions: completions.size,
    days,
    weekStart: query.weekStart ?? null,
    timeZone: "UTC",
    asOf,
    nextCursor:
      more && last
        ? { scope, through, asOf, createdAt: last.createdAt, id: last.id }
        : null,
  };
}
