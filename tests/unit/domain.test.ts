import { describe, it, expect } from "vitest";
import { createSeed } from "../../packages/domain/seed.js";
import {
  statistics,
  leafTasks,
  validateGraph,
  suggest,
  parsePaste,
  dateSchema,
} from "../../packages/domain/types.js";
const now = new Date("2026-10-10T12:00:00Z");
describe("single-source project data", () => {
  it("has 20 projects, 150 leaves, 90 completed and 60 unfinished", () => {
    const s = createSeed(now);
    expect(s.projects).toHaveLength(20);
    expect(s.tasks.length).toBeGreaterThan(150);
    expect(statistics(s.tasks, "all", now)).toMatchObject({
      total: 150,
      done: 90,
      unfinished: 60,
    });
    validateGraph(s.projects, s.tasks);
  });
  it("uses work scope instead of deadline, with today contained by the week", () => {
    const s = createSeed(now);
    expect(statistics(s.tasks, "week", now)).toMatchObject({
      total: 24,
      todo: 4,
      in_progress: 8,
      done: 10,
      blocked: 2,
    });
    expect(statistics(s.tasks, "today", now).total).toBe(8);
    const dated = s.tasks.map((t) => ({ ...t, dueDate: "2027-01-01" }));
    expect(statistics(dated, "week", now)).toEqual(
      statistics(s.tasks, "week", now),
    );
  });
  it("does not count parent status in totals", () => {
    const s = createSeed(now);
    s.tasks[0]!.status = "done";
    expect(statistics(s.tasks, "all", now).done).toBe(90);
    expect(leafTasks(s.tasks).some((t) => t.id.startsWith("group-"))).toBe(
      false,
    );
  });
  it("rejects cycles, orphan parents, duplicate IDs and cross-project parents", () => {
    for (const mutate of [
      (s: ReturnType<typeof createSeed>) => {
        s.tasks[1]!.parentId = s.tasks[1]!.id;
      },
      (s: ReturnType<typeof createSeed>) => {
        s.tasks[1]!.parentId = "missing";
      },
      (s: ReturnType<typeof createSeed>) => {
        s.tasks.push(s.tasks[1]!);
      },
      (s: ReturnType<typeof createSeed>) => {
        s.tasks[1]!.parentId = "group-1";
      },
    ]) {
      const s = createSeed(now);
      mutate(s);
      expect(() => validateGraph(s.projects, s.tasks)).toThrow();
    }
  });
  it("retains unmatched and ambiguous source lines for human review", () => {
    const s = createSeed(now);
    const result = suggest(
      "Atlas: review copy\nAtlas and Meridian: align\nUnmatched next step",
      s.projects,
    );
    expect(result[0]!.candidates).toHaveLength(1);
    expect(result[1]!.candidates).toHaveLength(2);
    expect(result[1]!.selectedProjectId).toBe("");
    expect(result[2]!.sourceLine).toBe(3);
    expect(result.every((r) => !r.confirmed)).toBe(true);
  });
  it("parses TSV without executing markup and validates real calendar dates", () => {
    expect(
      parsePaste("Task\tJamie\t2026-10-12\n<script>alert(1)</script>")[1]!
        .title,
    ).toContain("<script>");
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
  });
});
