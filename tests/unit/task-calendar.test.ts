import { describe, expect, it } from "vitest";
import {
  calendarWindow,
  calendarTaskPrefill,
  calendarTaskDateInput,
  projectTaskCalendar,
  shiftCalendarAnchor,
} from "../../packages/domain/task-calendar";
import { createSeed } from "../../packages/domain/seed";
import type { Task } from "../../packages/domain/types";
import {
  reminderInstant,
  editedReminderInstant,
  reminderLocalInput,
} from "../../packages/domain/time-zone";
const now = new Date("2026-10-16T12:00:00Z");
function fixture(): Task[] {
  return createSeed(now)
    .tasks.slice(0, 5)
    .map((task, i) => ({
      ...task,
      id: `t${i}`,
      parentId: null,
      workWeek: null,
      workDates: [] as string[],
      dueDate: null,
      estimatedDate: null,
      reminderAt: null,
    }));
}
describe("task calendar", () => {
  it("changes one date basis while preserving other fields and rejects invalid dates or mixed work weeks", () => {
    const task = fixture()[0]!;
    Object.assign(task, {
      dueDate: "2026-10-16",
      workWeek: "2026-10-12",
      workDates: ["2026-10-16"],
      estimatedDate: "2026-10-20",
      reminderAt: "2026-10-16T09:30:00Z",
    });
    const values = {
      date: "2026-10-22",
      workWeek: "2026-10-19",
      workDates: ["2026-10-22"],
      reminderAt: "2026-10-22T12:00:00Z",
    };
    const before = JSON.stringify(task);
    expect(calendarTaskDateInput(task, "due", values)).toMatchObject({
      dueDate: "2026-10-22",
      workWeek: task.workWeek,
      workDates: task.workDates,
      estimatedDate: task.estimatedDate,
      reminderAt: task.reminderAt,
      title: task.title,
    });
    expect(calendarTaskDateInput(task, "work", values)).toMatchObject({
      dueDate: task.dueDate,
      workWeek: "2026-10-19",
      workDates: ["2026-10-22"],
      reminderAt: task.reminderAt,
    });
    expect(calendarTaskDateInput(task, "estimated", values)).toMatchObject({
      dueDate: task.dueDate,
      estimatedDate: "2026-10-22",
      workDates: task.workDates,
    });
    expect(calendarTaskDateInput(task, "reminder", values)).toMatchObject({
      reminderAt: values.reminderAt,
      dueDate: task.dueDate,
      workDates: task.workDates,
    });
    expect(() =>
      calendarTaskDateInput(task, "due", { ...values, date: "2026-02-30" }),
    ).toThrow();
    expect(() =>
      calendarTaskDateInput(task, "work", {
        ...values,
        workDates: ["2026-10-16"],
      }),
    ).toThrow();
    expect(JSON.stringify(task)).toBe(before);
  });
  it("prefills only the selected date basis and requires an explicit reminder instant", () => {
    expect(calendarTaskPrefill("due", "2026-10-16")).toEqual({
      dueDate: "2026-10-16",
      workWeek: null,
      workDates: [],
      estimatedDate: null,
      reminderAt: null,
    });
    expect(calendarTaskPrefill("work", "2026-10-16")).toMatchObject({
      dueDate: null,
      workWeek: "2026-10-12",
      workDates: ["2026-10-16"],
      reminderAt: null,
    });
    expect(calendarTaskPrefill("estimated", "2026-10-16")).toMatchObject({
      dueDate: null,
      workWeek: null,
      estimatedDate: "2026-10-16",
    });
    expect(() => calendarTaskPrefill("reminder", "2026-10-16")).toThrow(
      "Choose a reminder time",
    );
    expect(
      calendarTaskPrefill("reminder", "2026-10-16", "2026-10-15T20:00:00Z"),
    ).toMatchObject({ dueDate: null, reminderAt: "2026-10-15T20:00:00Z" });
  });
  it("converts reminder edits in the displayed zone and rejects nonexistent or repeated DST times", () => {
    expect(
      editedReminderInstant(
        "2026-11-01T01:30",
        "2026-11-01T06:30:27Z",
        "America/New_York",
      ),
    ).toBe("2026-11-01T06:30:27Z");
    expect(
      editedReminderInstant("", "2026-11-01T06:30:27Z", "America/New_York"),
    ).toBeNull();
    for (const zone of [
      "UTC",
      "Asia/Shanghai",
      "America/New_York",
      "Australia/Lord_Howe",
    ]) {
      const instant = "2026-10-16T08:45:00Z";
      expect(reminderInstant(reminderLocalInput(instant, zone), zone)).toBe(
        instant,
      );
    }
    expect(reminderInstant("2026-10-16T09:00", "Asia/Shanghai")).toBe(
      "2026-10-16T01:00:00Z",
    );
    expect(() =>
      reminderInstant("2026-03-08T02:30", "America/New_York"),
    ).toThrow("unambiguous");
    expect(() =>
      reminderInstant("2026-11-01T01:30", "America/New_York"),
    ).toThrow("unambiguous");
    expect(() =>
      reminderInstant("2026-10-04T02:15", "Australia/Lord_Howe"),
    ).toThrow("unambiguous");
  });
  it("calculates Monday grids, leap days and clamped cross-year navigation using plain dates", () => {
    const month = calendarWindow("2024-02-29", "month");
    expect(month.days).toHaveLength(42);
    expect(month.start).toBe("2024-01-29");
    expect(month.days).toContain("2024-02-29");
    expect(calendarWindow("2027-01-01", "week").start).toBe("2026-12-28");
    expect(shiftCalendarAnchor("2024-01-31", "month", 1)).toBe("2024-02-29");
    expect(shiftCalendarAnchor("2026-12-31", "week", 1)).toBe("2027-01-07");
    expect(() => calendarWindow("2026-02-30", "month")).toThrow();
  });
  it("keeps multi-day event counts distinct from task counts and groups actual undated weeks", () => {
    const tasks = fixture();
    Object.assign(tasks[0]!, {
      workWeek: "2026-10-12",
      workDates: ["2026-10-15", "2026-10-16", "2026-10-16"],
    });
    Object.assign(tasks[1]!, { workWeek: "2026-10-05" });
    Object.assign(tasks[2]!, { workWeek: "2026-10-12" });
    Object.assign(tasks[3]!, { workWeek: "2026-10-19" });
    const before = JSON.stringify(tasks);
    const p = projectTaskCalendar(
      [...tasks, tasks[0]!],
      "work",
      calendarWindow("2026-10-16", "week"),
    );
    expect(p.events).toHaveLength(2);
    expect(new Set(p.events.map((e) => e.id)).size).toBe(2);
    expect(p.visibleTaskCount).toBe(1);
    expect(p.missing.map((t) => t.id)).toEqual(["t4"]);
    expect(p.undatedWeeks.map((g) => [g.week, g.inWindow])).toEqual([
      ["2026-10-05", false],
      ["2026-10-12", true],
      ["2026-10-19", false],
    ]);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("preserves due and estimated pure dates while reminders follow workspace midnight and DST", () => {
    const tasks = fixture();
    Object.assign(tasks[0]!, {
      dueDate: "2026-10-16",
      estimatedDate: "2026-11-01",
      reminderAt: "2026-10-15T20:00:00Z",
    });
    const window = calendarWindow("2026-10-16", "agenda");
    expect(
      projectTaskCalendar(tasks, "due", window, "America/New_York").events[0]!
        .date,
    ).toBe("2026-10-16");
    expect(
      projectTaskCalendar(tasks, "estimated", window).events[0]!.date,
    ).toBe("2026-11-01");
    expect(
      projectTaskCalendar(tasks, "reminder", window, "Asia/Shanghai").events[0]!
        .date,
    ).toBe("2026-10-16");
    expect(
      projectTaskCalendar(tasks, "reminder", window, "UTC").outsideTaskCount,
    ).toBe(1);
    tasks[0]!.reminderAt = "2026-11-01T05:30:00Z";
    tasks[1]!.reminderAt = "2026-11-01T06:30:00Z";
    expect(
      projectTaskCalendar(
        tasks,
        "reminder",
        calendarWindow("2026-11-01", "agenda"),
        "America/New_York",
      ).events.map((e) => e.date),
    ).toEqual(["2026-11-01", "2026-11-01"]);
  });
});
