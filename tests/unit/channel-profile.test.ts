import { expect, it } from "vitest";
import {
  formatChannelProfile,
  parseChannelProfile,
  blankContactText,
} from "../../packages/domain/channel-profile";
import type { Channel } from "../../packages/domain/channels";
const original: Channel = {
  id: "company",
  name: "测试公司",
  shortName: "公司",
  archived: false,
  address: "测试地址",
  notes: "合作说明\n公司电话：保留原文\n【联系人】\n继续说明",
  contacts: [
    {
      id: "c1",
      name: "甲",
      email: "test@example.test",
      primary: true,
      notes: "第一行\n电话：备注内容",
    },
  ],
};
it("roundtrips multiline company and contact notes while preserving identifiers", () => {
  const result = parseChannelProfile(formatChannelProfile(original), original);
  expect(result).toMatchObject(original);
});
it("edits all profile fields in one text and parses multiple contacts into structured records", () => {
  const text =
    formatChannelProfile(original).replace(
      "公司全称：测试公司",
      "公司全称：新的公司全称",
    ) +
    blankContactText
      .replace("姓名：", "姓名：乙")
      .replace("邮箱：", "邮箱：second@example.test");
  const result = parseChannelProfile(text, original);
  expect(result.name).toBe("新的公司全称");
  expect(result.id).toBe("company");
  expect(result.contacts).toHaveLength(2);
  expect(result.contacts![0]!.id).toBe("c1");
  expect(result.contacts![1]).toMatchObject({
    name: "乙",
    email: "second@example.test",
    primary: false,
  });
});
it("rejects duplicate fields, missing names, malformed email and multiple primary contacts", () => {
  for (const text of [
    formatChannelProfile(original).replace(
      "公司全称：测试公司",
      "公司全称：测试公司\n公司全称：重复",
    ),
    formatChannelProfile(original) + blankContactText,
    formatChannelProfile(original).replace(
      "test@example.test",
      "invalid email",
    ),
    formatChannelProfile(original) +
      blankContactText
        .replace("姓名：", "姓名：乙")
        .replace("主要联系人：否", "主要联系人：是"),
  ])
    expect(() => parseChannelProfile(text, original)).toThrow();
});
