import { describe, expect, it } from "vitest";
import {
  planTaskSchedules,
  taskScheduleBatchInput,
  TaskScheduleConflict,
} from "../../packages/domain/task-schedule-write";
import { createSeed } from "../../packages/domain/seed";
import type { Task } from "../../packages/domain/types";
function tasks(): Task[] {
  const base = createSeed().tasks[0]!;
  return ["a", "b"].map((id) => ({
    ...base,
    id,
    parentId: null,
    scheduleStart: null,
    scheduleEnd: null,
    milestone: false,
  }));
}
describe("explicit schedule writes", () => {
  it("plans only submitted fields and leaves all input unchanged", () => {
    const rows = tasks(),
      before = JSON.stringify(rows);
    const result = planTaskSchedules(
      rows,
      [
        {
          id: "a",
          version: rows[0]!.version,
          scheduleStart: "2026-10-16",
          scheduleEnd: "2026-10-17",
        },
      ],
      new Date("2026-10-16T12:00:00Z"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.after).toMatchObject({
      dueDate: rows[0]!.dueDate,
      workWeek: rows[0]!.workWeek,
      workDates: rows[0]!.workDates,
      scheduleStart: "2026-10-16",
      scheduleEnd: "2026-10-17",
      version: rows[0]!.version + 1,
    });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("rejects an entire invalid or stale plan and returns no write for unchanged values", () => {
    const rows = tasks();
    const first = {
      id: "a",
      version: rows[0]!.version,
      scheduleStart: "2026-10-16",
      scheduleEnd: "2026-10-17",
    };
    expect(() =>
      planTaskSchedules(rows, [
        first,
        { id: "b", version: 999, milestone: false },
      ]),
    ).toThrow(TaskScheduleConflict);
    expect(() =>
      planTaskSchedules(rows, [
        first,
        { id: "b", version: rows[1]!.version, scheduleStart: "2026-10-16" },
      ]),
    ).toThrow();
    expect(
      planTaskSchedules(rows, [
        {
          id: "a",
          version: rows[0]!.version,
          scheduleStart: null,
          scheduleEnd: null,
          milestone: false,
        },
      ]),
    ).toEqual([]);
    expect(() =>
      taskScheduleBatchInput.parse({ revision: 1, changes: [first, first] }),
    ).toThrow();
    expect(() =>
      taskScheduleBatchInput.parse({
        revision: 1,
        changes: Array.from({ length: 101 }, (_, i) => ({
          ...first,
          id: String(i),
        })),
      }),
    ).toThrow();
  });
});
