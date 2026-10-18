import { describe, expect, it } from "vitest";
import { dailyReportEvaluation } from "../fixtures/daily-report-evaluation";
import { parseDailyReport } from "../../packages/domain/daily-report";

describe("fixed synthetic daily-report baseline (no model calls)", () => {
  it("contains 30 distinct sources in six business categories", () => {
    expect(dailyReportEvaluation).toHaveLength(30);
    expect(new Set(dailyReportEvaluation.map((entry) => entry.id)).size).toBe(
      30,
    );
    expect(
      new Set(dailyReportEvaluation.map((entry) => entry.source)).size,
    ).toBe(30);
    expect(
      new Set(dailyReportEvaluation.map((entry) => entry.category)).size,
    ).toBe(6);
  });
  it.each(dailyReportEvaluation)("$id: $category", (example) => {
    const actual = parseDailyReport(example.source);
    expect(actual).not.toBeNull();
    expect(actual).toHaveLength(example.items.length);
    example.items.forEach(({ contains, ...expected }, index) => {
      const item = actual![index]!;
      expect(item).toMatchObject(expected);
      expect(item.title).toContain(contains);
      expect(item.sourceText).toBe(
        example.source.split("\n")[item.sourceLine - 1],
      );
      expect(item.workDate).toBe(example.workDate);
      expect(item.invalidWorkDate).toBe(example.invalidWorkDate);
      expect(item).not.toHaveProperty("dueDate");
    });
  });
});
