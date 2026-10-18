import { expect, it } from "vitest";
import {
  structuredCapture,
  captureNeedsProjectContext,
} from "../../apps/web/src/services/capture-routing";
import { intakeCandidates, planIntake } from "../../packages/domain/intake";
import { createSeed } from "../../packages/domain/seed";
it("routes pasted table headers and explicit new-project details to editable structured review", () => {
  expect(
    structuredCapture("项目\t负责人\t客户\n智慧园区\t李峰\t星河科技"),
  ).toBe(true);
  expect(structuredCapture("【表格.xlsx】\n项目\t负责人\n智慧园区\t李峰")).toBe(
    true,
  );
  expect(
    structuredCapture(
      "【表格.xlsx】\n【一表】\n项目\t负责人\n园区\t李峰\n【二表】\n客户\t项目\n甲\t学校",
    ),
  ).toBe(false);
  expect(
    structuredCapture(
      "新建项目：智慧园区；客户：星河科技；负责人：李峰；任务：确认需求",
    ),
  ).toBe(true);
  expect(structuredCapture("北二项目：设备安装已完成，需要安排调试。")).toBe(
    false,
  );
  expect(structuredCapture("1. 北二 设备清点\n2. 大榭 核对电表")).toBe(false);
  expect(structuredCapture("新建智慧园区项目")).toBe(true);
  expect(structuredCapture("新建项目：智慧园区")).toBe(true);
  expect(
    structuredCapture("项目：智慧园区；客户：星河\n北二项目：安装完成"),
  ).toBe(false);
});
it("creates a project and task from the unified entry with the supplied metadata", () => {
  const snapshot = createSeed();
  const source = {
    kind: "text" as const,
    name: "AI 录入",
    sheet: "",
    text: "新建项目：智慧园区；客户：星河科技；负责人：李峰；阶段：实施中；任务：确认需求",
  };
  const candidates = intakeCandidates(source, snapshot.projects);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]!.project).toMatchObject({
    name: "智慧园区",
    client: "星河科技",
    owner: "李峰",
    stage: "implementation",
  });
  const batch = planIntake(
    {
      source,
      confirmed: true,
      rows: candidates.map((c) => ({
        sourceRow: c.sourceRow,
        sourcePart: c.sourcePart,
        contextRows: c.contextRows,
        targetProjectId: c.targetProjectId,
        targetProjectVersion: c.targetProjectVersion,
        project: c.project,
        task: c.task,
        duplicateConfirmed: false,
        matchConfirmed: true,
      })),
    },
    snapshot,
    "tester",
    () => crypto.randomUUID(),
  );
  expect(batch.projects).toHaveLength(1);
  expect(batch.tasks[0]!.title).toBe("确认需求");
});

it("uses page context only when the input omits a project destination", () => {
  for (const text of [
    "项目：其他项目；任务：核对设备",
    "其他项目：核对设备",
    "新区码头：设备安装",
    "project: another workspace; task: inspect",
    "新建另一个项目 渠道公司",
  ])
    expect(captureNeedsProjectContext(text)).toBe(false);
  expect(captureNeedsProjectContext("今天设备安装完成，明天调试")).toBe(true);
  expect(captureNeedsProjectContext("任务：核对设备；执行人：李峰")).toBe(true);
});
