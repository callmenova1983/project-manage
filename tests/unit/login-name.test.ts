import { expect, it } from "vitest";
import {
  suggestedLoginName,
  availableLoginName,
} from "../../packages/domain/login-name";
it.each([
  ["郑元杰", "zhengyj"],
  ["李峰", "lif"],
  ["曾莉", "zengl"],
  ["欧阳娜娜", "ouyangnn"],
  ["司马光", "simag"],
  ["吕小明", "lvxm"],
  ["Alex Morgan", "alexm"],
  ["🙂", "member"],
])("generates the surname and given-name initials for %s", (name, expected) => {
  expect(suggestedLoginName(name)).toBe(expected);
});
it("handles names with identical initials without case-sensitive duplicates", () => {
  expect(suggestedLoginName("王欣")).toBe(suggestedLoginName("王鑫"));
  const taken = new Set(["wangx", "wangx2"]);
  expect(availableLoginName("wangx", (value) => taken.has(value))).toBe(
    "wangx3",
  );
});
