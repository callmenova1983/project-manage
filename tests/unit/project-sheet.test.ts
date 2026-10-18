import { describe, expect, it } from "vitest";
import {
  parseSheetClipboard,
  planSheetPaste,
  sheetClipboard,
} from "../../apps/web/src/services/project-sheet";

const stages = [{ id: "implementation", zh: "实施中", en: "Implementation" }];
describe("project spreadsheet clipboard", () => {
  it("round trips Excel cells containing tabs, quotes and multiple lines", () => {
    const cells = [
      ["郑元杰", "实施中", "客户“甲”"],
      ["李峰", "", '第一行\n第二行\t"备注"'],
    ];
    expect(parseSheetClipboard(sheetClipboard(cells) + "\r\n")).toEqual(cells);
  });
  it("maps pasted stage labels and empty cells to stored values", () => {
    const changes = planSheetPaste(
      "李峰\t实施中\t客户甲\r\n郑元杰\t\t",
      1,
      0,
      3,
      stages,
    );
    expect(changes).toHaveLength(6);
    expect(changes[1]).toMatchObject({
      row: 1,
      column: 1,
      field: "stage",
      value: "implementation",
    });
    expect(changes[4]?.value).toBe("unclassified");
    expect(changes[5]?.value).toBe("");
  });
  it("validates the entire range before returning edits", () => {
    expect(() =>
      planSheetPaste("李峰\t实施中\t甲\n郑元杰\t未知阶段\t乙", 0, 0, 2, stages),
    ).toThrow("未知阶段");
    expect(() => planSheetPaste("甲\t乙", 0, 2, 2, stages)).toThrow("列数");
    expect(() => planSheetPaste("甲\n乙", 1, 2, 2, stages)).toThrow("行数");
    expect(() => planSheetPaste('"没有闭合', 0, 0, 2, stages)).toThrow("引号");
  });
  it("rejects oversized values and excessive row counts", () => {
    expect(() => planSheetPaste("甲".repeat(81), 0, 0, 2, stages)).toThrow(
      "内容过长",
    );
    expect(() => parseSheetClipboard(Array(101).fill("甲").join("\n"))).toThrow(
      "100 行",
    );
  });
});
