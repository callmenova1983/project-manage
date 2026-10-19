import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
it("never turns hypothetical prerequisites into recorded progress", () => {
  const items = suggest(
    `### 台州一中项目
- 如果设备已完成调试，下周安排验收。
- 一旦资料已发送，后续联系厂家。
- 预计接口已恢复，现场需确认数据。`,
    projects,
  );
  expect(items).toHaveLength(3);
  expect(
    items.every((item) => item.action === "task" && item.status === "todo"),
  ).toBe(true);
  expect(items[0]?.title).toContain("如果");
  expect(items[1]?.title).toContain("一旦");
  expect(items[2]?.title).toContain("预计");
});
it("keeps conditions and uncertainty when splitting vendor and delivery followups", () => {
  const items = suggest(
    `### 台州一中项目
- 已与厂家沟通，厂家计划本周到现场处理设备问题。
- 天线采购正在推进，设备到货后完成贴标并寄送，月底前后安排现场工作。
- 现场施工基本完成，但网络环境和多厂家配合仍需推进。
- 现场存在空调控制异常，需要进一步确认。`,
    projects,
  );
  expect(items.map((item) => item.action)).toEqual([
    "update",
    "task",
    "update",
    "task",
    "update",
    "task",
    "update",
    "task",
  ]);
  expect(items[1]?.title).toBe("厂家计划本周到现场处理设备问题。");
  expect(items[3]?.title).toBe(
    "设备到货后完成贴标并寄送，月底前后安排现场工作。",
  );
  expect(items[4]?.status).toBe("in_progress");
  expect(
    items
      .filter((item) => item.action === "task")
      .every((item) => item.status === "todo"),
  ).toBe(true);
  for (const item of items) expect(item.sourceText).toContain(item.title);
});
it("records ongoing and blocked facts without fabricating new tasks", () => {
  const items = suggest(
    `### 台州一中项目
- 功能资料已发送，但对方尚未回复，接口协调仍是阻塞点。
- 海康已接入，其他系统尚未全部接入。
- 图纸更新和 BIM 建模工作同步推进。
- 计划下周完成接口接入。`,
    projects,
  );
  expect(items.map((item) => [item.action, item.status])).toEqual([
    ["update", "blocked"],
    ["update", "in_progress"],
    ["update", "in_progress"],
    ["task", "todo"],
  ]);
});
import { suggest } from "../../packages/domain/types";
import { createSeed } from "../../packages/domain/seed";
import {
  groupMeetingItems,
  meetingAutomaticProjects,
} from "../../packages/domain/meeting-completion";
import { validateSuggestions } from "../../apps/api/src/ai/provider";
import { repairMeetingContext } from "../../packages/domain/meeting-context-repair";
const projects = ["台州码头", "北二", "台州一中", "云和学校"].map(
  (name, i) => ({
    ...createSeed().projects[0]!,
    id: `p${i}`,
    name,
    shortName: name,
    aliases: [],
  }),
);
it("retains every body line of the reported meeting without turning headings into tasks", () => {
  const fullSource = readFileSync(
    new URL("../fixtures/meeting-project-progress.txt", import.meta.url),
    "utf8",
  );
  const allProjects = [
    "仑东所",
    "化工园",
    "派出所",
    "台州码头",
    "北二",
    "台州一中",
    "住建",
    "建工",
    "体育公园",
    "云和学校",
    "云和酒店",
  ].map((name) => ({ ...projects[0]!, id: name, name, shortName: name }));
  const items = suggest(fullSource, allProjects);
  const body = fullSource.split("\n").filter((line) => line.startsWith("- "));
  expect([...new Set(items.map((item) => item.sourceText))]).toEqual(body);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  for (const item of items) {
    expect(item.sourceText).toBe(fullSource.split("\n")[item.sourceLine - 1]);
    expect(item.sourceText).toContain(item.title);
  }
  expect(items.every((item) => !!item.sourceHeading)).toBe(true);
  expect(
    items.find((item) => item.title.includes("另一签字"))?.selectedProjectId,
  ).toBe("仑东所");
  expect(
    items.find((item) => item.title.includes("另一个码头"))?.candidates,
  ).toEqual([]);
  expect(
    items
      .find((item) => item.title.includes("住建侧雷达"))
      ?.candidates.map((c) => c.projectId)
      .sort(),
  ).toEqual(["住建", "建工"].sort());
});
const source = `## 重点项目进展
### 3. 台州码头及立项项目
- 台州码头项目计划本周进行线上沟通。
- 北二项目同步准备立项规格。
- 另一个码头项目计划参考台州项目同步申报。
### 5. 台州一中项目
- 天线采购及设备到货工作正在推进。
- 现场存在空调控制异常，需要进一步确认。
- 现场需同步确认整体策略和平台控制逻辑。
### 9. 云和学校项目
- 上周重点处理教师培训。
- 二期现场设备与平台点位已重新核对。`;
it("records completed facts as progress without marking mixed plans complete", () => {
  const items = suggest(
    `### 台州一中项目
- 两台设备已上线，策略调控配置已完成。
- 消防部分已基本完成，现场需确认消防点位。
- 问题已修复，下周继续观察。
- 预计本周完成验收。`,
    projects,
  );
  expect(items.map((item) => [item.action, item.status])).toEqual([
    ["update", "done"],
    ["update", "in_progress"],
    ["task", "todo"],
    ["update", "done"],
    ["task", "todo"],
    ["task", "todo"],
  ]);
  expect(items[1]?.sourceLine).toBe(items[2]?.sourceLine);
  expect(items[1]?.sourceText).toBe(items[2]?.sourceText);
  expect(items[1]?.title).toBe("消防部分已基本完成");
  expect(items[2]?.title).toBe("现场需确认消防点位。");
});
it("keeps another signature or device within the named project", () => {
  const items = suggest(
    `### 台州一中项目
- 运维相关款项已完成一方签字，仍待补齐另一签字环节。
- 另一个设备正在调试。
- 其他子系统接口仍未全部打通。
- 另一个码头项目计划参考台州项目同步申报。`,
    projects,
  );
  expect(items.map((item) => item.selectedProjectId)).toEqual([
    "p2",
    "p2",
    "p2",
    "",
  ]);
  expect(
    items.slice(0, 3).every((item) => item.sourceHeading === "台州一中项目"),
  ).toBe(true);
});
it("repairs pending context without altering applied items or replay receipts", () => {
  const original = {
    id: "old",
    source,
    sourceVersion: 1 as const,
    status: "draft" as const,
    createdAt: "2026-10-19",
    appliedSuggestionIds: ["saved"],
    appliedResults: [
      { suggestionId: "saved", projectId: "p0", taskId: "task-old" },
    ],
    suggestions: [
      {
        ...suggest("heading", [])[0]!,
        id: "heading",
        sourceLine: 2,
        sourceText: source.split("\n")[1]!,
      },
      { ...suggest(source, projects)[0]!, id: "saved" },
      { ...suggest(source, [])[4]!, id: "pending" },
    ],
  };
  const copy = structuredClone(original);
  const repaired = repairMeetingContext(original, projects);
  expect(original).toEqual(copy);
  expect(repaired.skippedSuggestionIds).toEqual(["heading"]);
  expect(repaired.suggestions[1]).toEqual(original.suggestions[1]);
  expect(repaired.appliedResults).toEqual(original.appliedResults);
  expect(repaired.suggestions[2]?.candidates.map((c) => c.projectId)).toEqual([
    "p2",
  ]);
  expect(repairMeetingContext(repaired, projects)).toEqual(repaired);
});
it("inherits section projects, excludes headings and respects explicitly different projects", () => {
  const items = suggest(source, projects);
  expect(items).toHaveLength(9);
  expect(items.map((s) => s.selectedProjectId)).toEqual([
    "p0",
    "p1",
    "",
    "p2",
    "p2",
    "p2",
    "p2",
    "p3",
    "p3",
  ]);
  for (const item of items)
    expect(item.sourceText).toBe(source.split("\n")[item.sourceLine - 1]);
  expect(items.filter(item => item.sourceLine === 8).map(item => [item.title, item.action])).toEqual([
    ["现场存在空调控制异常", "update"], ["需要进一步确认。", "task"],
  ]);
});
it("groups unresolved sections once instead of inventing project names from body prefixes", () => {
  const groups = groupMeetingItems(suggest(source, []), []);
  expect(groups.map((g) => g.name)).toEqual([
    "台州码头及立项项目",
    "其他项目（需明确）",
    "台州一中项目",
    "云和学校项目",
  ]);
  expect(groups.map((g) => g.items.length)).toEqual([2, 1, 4, 2]);
});
it("applies the same context when AI returns no candidates", () => {
  const items = validateSuggestions(
    {
      suggestions: [
        {
          sourceLine: 8,
          quote: "现场存在空调控制异常，需要进一步确认。",
          title: "现场空调异常",
          projectIds: [],
          reason: "未指定",
          action: "update",
          status: "blocked",
        },
      ],
    },
    source,
    projects,
  );
  expect(items[0]?.candidates.map((c) => c.projectId)).toEqual(["p2"]);
  expect(items[0]?.sourceHeading).toBe("台州一中项目");
  expect(items[0]?.action).toBe("update");
});
it("does not assign an unnamed other project to the model's reference project", () => {
  const items = validateSuggestions(
    {
      suggestions: [
        {
          sourceLine: 5,
          quote: "另一个码头项目计划参考台州项目同步申报。",
          title: "码头申报",
          projectIds: ["p2"],
          reason: "参考台州",
          action: "task",
          status: "todo",
        },
      ],
    },
    source,
    projects,
  );
  expect(items[0]?.candidates).toEqual([]);
  expect(meetingAutomaticProjects(items[0]!, projects)).toEqual([]);
  expect(items[0]?.sourceHeading).toBe("其他项目（需明确）");
  const pending = {
    ...items[0]!,
    candidates: [{ projectId: "p2", reason: "旧错误候选" }],
  };
  const repaired = repairMeetingContext(
    {
      id: "ambiguous-old",
      source,
      sourceVersion: 1,
      status: "draft",
      createdAt: "2026-10-19",
      suggestions: [pending],
    },
    projects,
  );
  expect(repaired.suggestions[0]?.candidates).toEqual([]);
});
