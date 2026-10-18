import { describe, expect, it } from "vitest";
import {
  retainTaskSchedule,
  validateTaskSchedule,
} from "../../packages/domain/task-schedule";
import { createSeed } from "../../packages/domain/seed";
import { taskInput, validateGraph } from "../../packages/domain/types";
describe("independent task schedule", () => {
  it("accepts a day, cross-year range and same-day milestone without touching other dates", () => {
    for (const value of [
      { scheduleStart: "2026-10-16", scheduleEnd: "2026-10-16" },
      { scheduleStart: "2026-12-28", scheduleEnd: "2027-01-10" },
      {
        scheduleStart: "2026-10-16",
        scheduleEnd: "2026-10-16",
        milestone: true,
      },
      {},
    ])
      expect(() => validateTaskSchedule(value)).not.toThrow();
    for (const value of [
      { scheduleStart: "2026-10-16" },
      { scheduleEnd: "2026-10-16" },
      { scheduleStart: "2026-10-18", scheduleEnd: "2026-10-16" },
      { milestone: true },
      {
        scheduleStart: "2026-10-16",
        scheduleEnd: "2026-10-17",
        milestone: true,
      },
      { scheduleStart: "2026-02-30", scheduleEnd: "2026-03-01" },
    ])
      expect(() => validateTaskSchedule(value)).toThrow();
  });
  it("preserves omitted fields but honors explicit null and false", () => {
    const base = taskInput.strip().parse(createSeed().tasks[0]!);
    const previous = {
      ...base,
      scheduleStart: "2026-10-16",
      scheduleEnd: "2026-10-16",
      milestone: true,
    };
    const oldForm = { ...base, title: "Only title changes" };
    expect(retainTaskSchedule(oldForm, previous)).toEqual({
      ...previous,
      title: oldForm.title,
    });
    expect(
      retainTaskSchedule(
        { ...base, scheduleStart: null, scheduleEnd: null, milestone: false },
        previous,
      ),
    ).toMatchObject({
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
    });
    expect(base).not.toHaveProperty("scheduleStart");
  });
  it("rejects turning an independently scheduled task into a parent", () => {
    const seed = createSeed();
    const parent = {
      ...seed.tasks[0]!,
      id: "scheduled",
      parentId: null,
      scheduleStart: "2026-10-16",
      scheduleEnd: "2026-10-17",
    };
    const child = { ...seed.tasks[0]!, id: "child", parentId: parent.id };
    expect(() => validateGraph(seed.projects, [parent, child])).toThrow(
      "aggregate schedules",
    );
    expect(() =>
      validateGraph(seed.projects, [
        { ...parent, scheduleStart: null, scheduleEnd: null, milestone: false },
        child,
      ]),
    ).not.toThrow();
  });
});
