import { expect, it } from "vitest";
import { defaultCatalogs } from "../../packages/domain/admin";
import { channelEntries } from "../../packages/domain/channels";
import {
  intakeCandidates,
  planIntake,
  type IntakeSource,
} from "../../packages/domain/intake";
import { createSeed } from "../../packages/domain/seed";
import { projectInput } from "../../packages/domain/types";
import {
  meetingReplyDraft,
  groupMeetingItems,
} from "../../packages/domain/meeting-completion";
import { suggest } from "../../packages/domain/types";
import {
  structuredCapture,
  normalizeCreationText,
} from "../../apps/web/src/services/capture-routing";
const channels = [
  ...channelEntries(defaultCatalogs),
  {
    id: "longying",
    name: "龙赢科技有限公司",
    shortName: "龙赢",
    archived: false,
  },
];
const catalog = { ...defaultCatalogs, channels };
function candidates(text: string) {
  const source: IntakeSource = { kind: "text", name: "原文", sheet: "", text };
  return {
    source,
    rows: intakeCandidates(source, [], undefined, true, catalog),
  };
}
it.each([
  "新建宁海数字平台项目 渠道是 龙赢",
  "新建项目：宁海数字平台项目；渠道：龙赢",
  "创建宁海数字平台项目，渠道为龙赢",
])("retains the channel and creates no invented task: %s", (text) => {
  expect(structuredCapture(text)).toBe(true);
  expect(normalizeCreationText(text)).toContain("项目：");
  const { rows } = candidates(text);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.project).toMatchObject({
    name: "宁海数字平台项目",
    channelId: "longying",
  });
  expect(rows[0]!.task).toBeNull();
  expect(rows[0]!.sourceText).toBe(text);
  expect(meetingReplyDraft(text, channels, catalog)).toMatchObject({
    name: "宁海数字平台项目",
    channelId: "longying",
  });
  expect(groupMeetingItems(suggest(text, []), [])[0]!.name).toBe(
    "宁海数字平台项目",
  );
});
it("carries explicit project and task fields through recognition and creation without losing the original source", () => {
  const text =
    "新建宁海数字平台项目 渠道是 龙赢；客户：宁海学校；项目负责人：郑元杰；阶段：实施中；简称：宁海平台；别名：宁海数平、宁海数字化；描述：数字化平台建设；任务：确认现场点位；执行人：叶晨曦；截止日期：2026-10-20；状态：进行中";
  const { source, rows } = candidates(text),
    row = rows[0]!;
  const expected = {
    name: "宁海数字平台项目",
    channelId: "longying",
    client: "宁海学校",
    owner: "郑元杰",
    stage: "implementation",
    shortName: "宁海平台",
    aliases: ["宁海数平", "宁海数字化"],
    description: "数字化平台建设",
  };
  expect(row.project).toMatchObject(expected);
  expect(row.task).toMatchObject({
    title: "确认现场点位",
    assignee: "叶晨曦",
    dueDate: "2026-10-20",
    status: "in_progress",
  });
  const batch = planIntake(
    {
      source,
      confirmed: true,
      rows: rows.map((c) => ({
        sourceRow: c.sourceRow,
        sourcePart: c.sourcePart,
        contextRows: c.contextRows,
        targetProjectId: "",
        targetProjectVersion: null,
        project: c.project,
        task: c.task,
        duplicateConfirmed: false,
        matchConfirmed: true,
      })),
    },
    { ...createSeed(), catalogs: catalog },
    "test",
    () => crypto.randomUUID(),
  );
  expect(batch.projects[0]).toMatchObject(expected);
  expect(batch.tasks[0]).toMatchObject(row.task!);
  expect(batch.source.text).toBe(text);
  expect(meetingReplyDraft(text, channels, catalog).details).toMatchObject({
    client: expected.client,
    owner: expected.owner,
    stage: expected.stage,
    shortName: expected.shortName,
    aliases: expected.aliases,
    description: expected.description,
  });
});
it("supports channel columns in pasted Excel and does not silently fall back for unknown or conflicting channels", () => {
  const source: IntakeSource = {
    kind: "csv",
    name: "表格",
    sheet: "",
    text: "",
    rows: [
      ["项目", "渠道", "简称", "客户", "负责人", "阶段"],
      ["宁海数字平台项目", "龙赢", "宁海平台", "宁海学校", "郑元杰", "实施中"],
    ],
  };
  expect(
    intakeCandidates(source, [], undefined, true, catalog)[0]!.project,
  ).toMatchObject({
    channelId: "longying",
    shortName: "宁海平台",
    owner: "郑元杰",
  });
  for (const text of [
    "新建宁海数字平台项目 渠道是 未登记渠道",
    "新建宁海数字平台项目；渠道：龙赢；渠道：建工",
  ]) {
    const row = candidates(text).rows[0]!;
    expect(row.project.channelId).toBe("");
    expect(projectInput.safeParse(row.project).success).toBe(false);
    expect(row.warnings.length).toBeGreaterThan(0);
    expect(meetingReplyDraft(text, channels, catalog).channelId).toBe("");
  }
});
