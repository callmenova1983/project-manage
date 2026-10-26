import { z } from "zod";
import { dateSchema, weekKey, type Activity } from "./types.js";
import { weekBounds, zonedDay, timeZoneInput } from "./time-zone.js";
import { isCompletionAction } from "./activity-summary.js";

export const activityQueryInput = z
  .object({
    timeZone: timeZoneInput.optional(),
    checkpoint: z
      .object({
        scope: z.string().max(110000),
        through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        asOf: z.string().datetime(),
      })
      .strict()
      .optional(),
    weekStart: dateSchema
      .refine((v) => weekKey(new Date(v)) === v, "Choose a Monday week start")
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
  timeZone: string;
  bounds: { start: string; end: string } | null;
  checkpoint: { scope: string; through: number; asOf: string };
  asOf: string;
}
export function activityScope(query: ActivityQuery) {
  return JSON.stringify({
    timeZone: query.timeZone ?? "UTC",
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
  bounds = query.weekStart
    ? weekBounds(query.weekStart, query.timeZone ?? "UTC")
    : null,
) {
  const at = Date.parse(activity.createdAt);
  const start = bounds ? Date.parse(bounds.start) : -Infinity;
  const search = query.search?.trim().toLowerCase();
  return (
    Number.isFinite(at) &&
    at >= start &&
    (!bounds || at < Date.parse(bounds.end)) &&
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
  exportAll = false,
): ActivityPage {
  activityQueryInput.parse(query);
  const scope = activityScope(query);
  if (
    [query.cursor, query.checkpoint].some(
      (point) => point && point.scope !== scope,
    )
  )
    throw new Error("Activity filters changed. Reload the first page.");
  const asOf =
    query.cursor?.asOf ?? query.checkpoint?.asOf ?? now.toISOString();
  if (Date.parse(asOf) > now.getTime())
    throw new Error("History cutoff cannot be in the future");
  const events: Activity[] = [];
  let total = 0;
  const projects = new Set<string>(),
    completions = new Set<string>(),
    seen = new Set<string>();
  const timeZone = query.timeZone ?? "UTC";
  const bounds = query.weekStart ? weekBounds(query.weekStart, timeZone) : null;
  const days = bounds ? bounds.days.map((date) => ({ date, count: 0 })) : [];
  const dayCounts = new Map(days.map((day) => [day.date, day]));
  const limit = exportAll ? 10000 : (query.limit ?? 25);
  for (const a of source) {
    if (seen.has(a.id) || !matchesActivity(a, query, asOf, bounds)) continue;
    seen.add(a.id);
    total++;
    if (a.projectId) projects.add(a.projectId);
    if (days.length)
      dayCounts.get(zonedDay(new Date(a.createdAt), timeZone))!.count++;
    if (isCompletionAction(a))
      completions.add(`${a.entityId}:${a.before!.version}:${a.after!.version}`);
    if (
      events.length <= limit &&
      (exportAll || !query.cursor || compareActivities(a, query.cursor) > 0)
    )
      events.push(a);
  }
  if (exportAll && total > 10000)
    throw new Error(
      "Export up to 10000 events at a time. Narrow the history filters.",
    );
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
    timeZone,
    bounds: bounds ? { start: bounds.start, end: bounds.end } : null,
    checkpoint: { scope, through, asOf },
    asOf,
    nextCursor:
      more && last
        ? { scope, through, asOf, createdAt: last.createdAt, id: last.id }
        : null,
  };
}
