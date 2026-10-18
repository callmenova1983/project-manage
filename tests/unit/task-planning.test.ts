import { describe, expect, it } from "vitest";
import {
  moveTaskWorkWeek,
  setTaskWorkDay,
} from "../../packages/domain/task-planning";

describe("explicit weekly work planning", () => {
  it("moves every selected weekday together, including across DST and year boundaries", () => {
    const plan = {
      workWeek: "2026-10-26",
      workDates: ["2026-10-27", "2026-11-01"],
    };
    expect(moveTaskWorkWeek(plan, "2026-11-04")).toEqual({
      workWeek: "2026-11-02",
      workDates: ["2026-11-03", "2026-11-08"],
    });
    expect(moveTaskWorkWeek(plan, "2027-01-02")).toEqual({
      workWeek: "2026-12-28",
      workDates: ["2026-12-29", "2027-01-03"],
    });
    expect(plan).toEqual({
      workWeek: "2026-10-26",
      workDates: ["2026-10-27", "2026-11-01"],
    });
  });
  it("removes one day without dropping the other dates or clearing the work week", () => {
    expect(
      setTaskWorkDay(
        { workWeek: "2026-10-12", workDates: ["2026-10-13", "2026-10-16"] },
        "2026-10-16",
        false,
      ),
    ).toEqual({ workWeek: "2026-10-12", workDates: ["2026-10-13"] });
    expect(
      setTaskWorkDay(
        { workWeek: "2026-10-12", workDates: ["2026-10-16"] },
        "2026-10-16",
        false,
      ),
    ).toEqual({ workWeek: "2026-10-12", workDates: [] });
  });
  it("adds today to an explicitly moved week and deduplicates dates", () => {
    const plan = {
      workWeek: "2026-10-12",
      workDates: ["2026-10-13", "2026-10-16"],
    };
    expect(setTaskWorkDay(plan, "2026-10-20", true)).toEqual({
      workWeek: "2026-10-19",
      workDates: ["2026-10-20", "2026-10-23"],
    });
    expect(
      setTaskWorkDay({ workWeek: null, workDates: [] }, "2026-10-20", true),
    ).toEqual({ workWeek: "2026-10-19", workDates: ["2026-10-20"] });
  });
  it("allows week-only plans and explicit clearing, and rejects malformed existing plans", () => {
    expect(
      moveTaskWorkWeek({ workWeek: null, workDates: [] }, "2026-10-21"),
    ).toEqual({ workWeek: "2026-10-19", workDates: [] });
    expect(
      moveTaskWorkWeek(
        { workWeek: "2026-10-12", workDates: ["2026-10-13"] },
        null,
      ),
    ).toEqual({ workWeek: null, workDates: [] });
    expect(() =>
      moveTaskWorkWeek(
        { workWeek: "2026-10-12", workDates: ["2026-10-20"] },
        "2026-10-19",
      ),
    ).toThrow("belong");
    expect(() =>
      moveTaskWorkWeek({ workWeek: "2026-10-13", workDates: [] }, "2026-10-19"),
    ).toThrow("Monday");
    expect(() =>
      moveTaskWorkWeek({ workWeek: null, workDates: [] }, "2026-02-30"),
    ).toThrow();
  });
});
