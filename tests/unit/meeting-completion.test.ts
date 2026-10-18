import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { suggest, type Proposal } from "../../packages/domain/types";
import {
  pendingMeetingItems,
  settleMeetingProposal,
  validateMeetingSelection,
  meetingReplyProjects,
  meetingReplyDraft,
  meetingNewProjectFields,
  groupMeetingItems,
} from "../../packages/domain/meeting-completion";
const projects = createSeed().projects;
const channels = [
  { id: "company", name: "公司", shortName: "公司", archived: false },
  { id: "zhedian", name: "浙江电力", shortName: "浙电", archived: false },
];
const source = "Atlas: confirm scope\nAtlas and Meridian: review handoff";
const proposal: Proposal = {
  id: "meeting",
  source,
  sourceVersion: 1,
  createdAt: new Date().toISOString(),
  status: "draft",
  suggestions: suggest(source, projects),
};
it("records clear items once while leaving ambiguous items available for a same-page reply", () => {
  const result = settleMeetingProposal(
    proposal,
    [{ ...proposal.suggestions[0]!, confirmed: true }],
    { partial: true },
  );
  expect(result.status).toBe("draft");
  expect(pendingMeetingItems(result).map((s) => s.id)).toEqual(["line-2"]);
  expect(result.source).toBe(source);
  expect(() => validateMeetingSelection(result, ["line-1"], [])).toThrow(
    "already recorded",
  );
  const complete = settleMeetingProposal(result, [], {
    partial: true,
    skippedIds: ["line-2"],
  });
  expect(complete.status).toBe("applied");
  expect(pendingMeetingItems(complete)).toEqual([]);
});
it("accepts a project reply by name, alias or short name and leaves ambiguous replies unresolved", () => {
  expect(meetingReplyProjects("归到 Atlas", projects).map((p) => p.id)).toEqual(
    ["project-1"],
  );
  expect(meetingReplyProjects("Atlas 和 Meridian", projects)).toHaveLength(2);
  expect(
    meetingReplyProjects("归到校区", [{ ...projects[0]!, shortName: "校区" }]),
  ).toHaveLength(1);
});
it("rejects duplicate, overlapping, unknown and empty selections", () => {
  for (const [ids, skipped] of [
    [[], []],
    [["line-1", "line-1"], []],
    [["line-1"], ["line-1"]],
    [["unknown"], []],
  ])
    expect(() => validateMeetingSelection(proposal, ids!, skipped!)).toThrow();
});
it("suggests unseen project names from repeated source prefixes and groups related items without hard-coded names", () => {
  const raw =
    "重儿安消平台传感器点位标注，点位报警跳转问题沟通调整\n数聚公司竞赛设备清单协助沟通\n重儿能耗分摊方案协助编制\n重儿地下室照明网关安装完善";
  const groups = groupMeetingItems(suggest(raw, projects), projects);
  expect(groups.map((group) => [group.name, group.items.length])).toEqual([
    ["重儿", 3],
    ["数聚公司", 1],
  ]);
  const alternate = groupMeetingItems(
    suggest(raw.replaceAll("重儿", "海川"), projects),
    projects,
  );
  expect(alternate[0]!.name).toBe("海川");
  expect(
    groupMeetingItems(
      suggest("本周确认设备\n本周确认图纸", projects),
      projects,
    ).every((group) => !group.name),
  ).toBe(true);
});
it("recognizes an existing project's abbreviated name with a project suffix", () => {
  expect(
    meetingReplyProjects("重儿安消平台传感器点位标注", [
      { ...projects[0]!, name: "重儿项目", shortName: "", aliases: [] },
    ]),
  ).toHaveLength(1);
});
it("extracts a confirmed project draft with a channel without treating the channel as a project", () => {
  expect(
    meetingReplyDraft("韵升项目，渠道是浙电，如果没有就新建这个项目", channels),
  ).toMatchObject({
    name: "韵升项目",
    channelId: "zhedian",
    unmatchedChannel: "",
  });
  expect(
    meetingReplyDraft("1.新建韵升项目：整理验收材料，渠道为浙电", channels)
      .name,
  ).toBe("韵升项目");
  expect(
    meetingReplyProjects("韵升项目，渠道是浙电，如果没有就新建", [
      { ...projects[0]!, name: "浙电", aliases: [] },
    ]),
  ).toEqual([]);
});
it("requires explicit confirmation, rejects duplicate names and does not silently replace an unknown channel", () => {
  const raw = {
    name: "韵升项目",
    suggestionId: "line-1",
    channelId: "zhedian",
    confirmed: true as const,
  };
  expect(meetingNewProjectFields(raw, projects, channels)).toMatchObject({
    name: "韵升项目",
    channelId: "zhedian",
    stage: "unclassified",
    owner: "",
  });
  expect(() =>
    meetingNewProjectFields(
      { ...raw, confirmed: false } as never,
      projects,
      channels,
    ),
  ).toThrow();
  expect(() =>
    meetingNewProjectFields(
      raw,
      [{ ...projects[0]!, name: "韵升", aliases: [] }],
      channels,
    ),
  ).toThrow("已有同名项目");
  expect(
    meetingReplyDraft("韵升项目，渠道是未登记渠道", channels),
  ).toMatchObject({ channelId: "", unmatchedChannel: "未登记渠道" });
  expect(() =>
    meetingNewProjectFields(
      { ...raw, channelId: "missing" },
      projects,
      channels,
    ),
  ).toThrow("请选择可用渠道");
});
