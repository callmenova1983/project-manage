import { it, expect, afterEach } from "vitest";
import {
  validTimeZone,
  weekBounds,
  zonedDay,
  zonedWeek,
  calendarWeek,
  nextZonedDayBoundary,
  calendarRefreshDelay,
} from "../../packages/domain/time-zone";
import {
  queryActivities,
  compareActivities,
} from "../../packages/domain/activity-query";
import { summarizeWeeklyActivity } from "../../packages/domain/activity-summary";
import { statistics, type Activity } from "../../packages/domain/types";
import { createSeed } from "../../packages/domain/seed";
import { formatDate, locale } from "../../apps/web/src/locales";
import { workspaceTimeZone } from "../../apps/web/src/composables/calendar";
import {
  filterTaskWork,
  readTaskFilters,
} from "../../apps/web/src/composables/task-focus";
import { plannedWork } from "../../apps/web/src/composables/planned-work";
afterEach(() => {
  workspaceTimeZone.value = "UTC";
  locale.value = "en";
});
it.each([
  ["2026-03-08T05:00:00Z", "America/New_York", "2026-03-09T04:00:00Z", 23],
  ["2026-11-01T04:00:00Z", "America/New_York", "2026-11-02T05:00:00Z", 25],
  ["2026-10-03T13:30:00Z", "Australia/Lord_Howe", "2026-10-04T13:00:00Z", 23.5],
  ["2026-10-15T16:00:00Z", "Asia/Shanghai", "2026-10-16T16:00:00Z", 24],
])("schedules actual next midnight for %s in %s", (start, zone, end, hours) => {
  const date = new Date(String(start));
  expect(nextZonedDayBoundary(date, String(zone))).toBe(
    Date.parse(String(end)),
  );
  expect(
    (nextZonedDayBoundary(date, String(zone)) - date.getTime()) / 3600000,
  ).toBe(hours);
  const before = new Date(Date.parse(String(end)) - 250);
  expect(calendarRefreshDelay(before, String(zone))).toBe(260);
  expect(
    zonedDay(
      new Date(before.getTime() + calendarRefreshDelay(before, String(zone))),
      String(zone),
    ),
  ).not.toBe(zonedDay(before, String(zone)));
});
it.each([
  ["UTC", true],
  ["Asia/Shanghai", true],
  ["America/New_York", true],
  ["Australia/Lord_Howe", true],
  ["Europe/London", true],
  ["+08:00", false],
  ["UTC+8", false],
  ["Imaginary/Beijing", false],
  ["", false],
])("validates IANA region %s", (value, valid) =>
  expect(validTimeZone(String(value))).toBe(valid),
);
it("uses Beijing Monday midnight and keeps UTC defaults compatible", () => {
  const before = new Date("2026-10-11T15:59:59.999Z"),
    start = new Date("2026-10-11T16:00:00Z");
  expect(zonedWeek(before, "Asia/Shanghai")).toBe("2026-10-05");
  expect(zonedWeek(start, "Asia/Shanghai")).toBe("2026-10-12");
  expect(zonedDay(start, "Asia/Shanghai")).toBe("2026-10-12");
  expect(zonedWeek(start)).toBe("2026-10-05");
  expect(calendarWeek("2026-10-14")).toBe("2026-10-12");
  expect(weekBounds("2026-10-12", "Asia/Shanghai")).toMatchObject({
    start: "2026-10-11T16:00:00.000Z",
    end: "2026-10-18T16:00:00.000Z",
  });
});
it.each([
  ["2026-03-02", "America/New_York", 167],
  ["2026-10-26", "America/New_York", 169],
  ["2026-03-23", "Europe/London", 167],
  ["2026-09-28", "Australia/Lord_Howe", 167.5],
  ["2026-03-30", "Australia/Lord_Howe", 168.5],
])("uses actual DST week duration %s %s", (week, zone, hours) => {
  const bounds = weekBounds(String(week), String(zone));
  expect((Date.parse(bounds.end) - Date.parse(bounds.start)) / 3600000).toBe(
    hours,
  );
  expect(new Set(bounds.days).size).toBe(7);
});
it("shares exclusive week bounds, daily counts and export snapshot in DST weeks", () => {
  const make = (id: string, at: string): Activity => ({
    id,
    createdAt: at,
    projectId: "p",
    entityId: "p",
    kind: "project",
    action: "Updated project",
    actor: "Synthetic",
    source: "Synthetic test",
    before: null,
    after: null,
  });
  const events = [
    make("before", "2026-03-02T04:59:59.999Z"),
    make("start", "2026-03-02T05:00:00Z"),
    make("sun-before", "2026-03-08T06:59:59Z"),
    make("sun-after", "2026-03-08T07:00:00Z"),
    make("last", "2026-03-09T03:59:59.999Z"),
    make("next", "2026-03-09T04:00:00Z"),
  ].sort(compareActivities);
  const query = {
    weekStart: "2026-03-02",
    timeZone: "America/New_York",
    limit: 1,
  };
  const now = new Date("2026-03-10");
  const first = queryActivities(events, query, events.length, now);
  expect(first.total).toBe(4);
  expect(first.days.map((d) => d.count)).toEqual([1, 0, 0, 0, 0, 0, 3]);
  const summary = summarizeWeeklyActivity(events, { ...query, now });
  expect(summary.days).toEqual(first.days);
  expect(summary.changeCount).toBe(first.total);
  const exported = queryActivities(
    events,
    { ...query, checkpoint: first.checkpoint },
    events.length,
    now,
    true,
  );
  expect(exported.events).toHaveLength(4);
  expect(exported.bounds).toEqual(first.bounds);
  expect(exported.checkpoint).toEqual(first.checkpoint);
  expect(() =>
    queryActivities(
      events,
      { ...query, timeZone: "UTC", cursor: first.nextCursor! },
      events.length,
      now,
    ),
  ).toThrow("filters changed");
});
it("aligns planned dates, filters and totals without moving stored calendar labels", () => {
  const seed = createSeed(),
    now = new Date("2026-10-11T16:00:00Z");
  const tasks = [
    {
      ...seed.tasks[0]!,
      parentId: null,
      status: "todo" as const,
      workWeek: "2026-10-12",
      workDates: ["2026-10-12"],
    },
  ];
  expect(statistics(tasks, "today", now, "UTC").total).toBe(0);
  expect(statistics(tasks, "today", now, "Asia/Shanghai").total).toBe(1);
  expect(statistics(tasks, "week", now, "Asia/Shanghai").total).toBe(1);
  expect(
    filterTaskWork(
      tasks,
      readTaskFilters({ scope: "today" }),
      now,
      [],
      "Asia/Shanghai",
    ),
  ).toHaveLength(1);
  expect(
    plannedWork(tasks, seed.projects, "today", now, "Asia/Shanghai"),
  ).toHaveLength(1);
  workspaceTimeZone.value = "America/Los_Angeles";
  locale.value = "en";
  expect(formatDate("2026-10-12", { day: "numeric" })).toBe("12");
  workspaceTimeZone.value = "Asia/Shanghai";
  expect(formatDate("2026-10-11T16:00:00Z", { day: "numeric" })).toBe("12");
  expect(tasks[0]!.workDates).toEqual(["2026-10-12"]);
});

it("exports up to the documented bound and rejects oversized histories without truncation", () => {
  const events = Array.from({ length: 10001 }, (_, i): Activity => ({
    id: `bounded-${i}`,
    createdAt: "2020-01-01T00:00:00Z",
    projectId: null,
    entityId: "workspace",
    kind: "import",
    action: "Synthetic import",
    actor: "Synthetic",
    source: "Synthetic export bound",
    before: null,
    after: null,
  }));
  const now = new Date("2021-01-01");
  expect(
    queryActivities(events.slice(0, 10000), {}, 10000, now, true).events,
  ).toHaveLength(10000);
  expect(() => queryActivities(events, {}, 10001, now, true)).toThrow(
    "Narrow the history filters",
  );
});
