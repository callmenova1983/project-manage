import type {
  ReportEvaluationCase,
  ExpectedReportItem,
} from "./daily-report-evaluation.js";

// Frozen before the first live run. Synthetic acceptance cases, not production
// accuracy evidence. Do not tune labels to observed model/parser output.
const item = (
  contains: string,
  action: ExpectedReportItem["action"] = "update",
  status: ExpectedReportItem["status"] = "done",
  assignee = "陈晨",
): ExpectedReportItem => ({ contains, action, status, assignee });
const entry = (
  id: string,
  text: string,
  items: ExpectedReportItem[],
): ReportEvaluationCase => ({
  id,
  category: "independent-synthetic",
  source: `陈晨\nReport to:赵经理\n今日工作总结\n${text}`,
  items,
});

export const dailyReportHoldout: ReportEvaluationCase[] = [
  entry("holdout-01", "1. 青禾学校核实机房端口标识", [item("端口标识")]),
  entry("holdout-02", "1. 青禾学校与物业沟通入场手续", [item("入场手续")]),
  entry("holdout-03", "1. 青禾学校整理能耗报表并发送客户", [item("发送客户")]),
  entry("holdout-04", "1. 青禾学校门禁联调已完成", [item("门禁联调")]),
  entry("holdout-05", "1. 青禾学校确认会议室控制点位清单", [item("点位清单")]),
  entry("holdout-06", "1. 青禾学校告警规则仍在调整，尚未完成", [
    item("尚未完成", "update", "in_progress"),
  ]),
  entry("holdout-07", "1. 青禾学校监控调试受阻，等待客户审批", [
    item("等待客户审批", "update", "blocked"),
  ]),
  entry("holdout-08", "1. 青禾学校报表核对未完成", [
    item("未完成", "update", "in_progress"),
  ]),
  entry("holdout-09", "1. 青禾学校安装暂停，等待配件到货", [
    item("等待配件", "update", "blocked"),
  ]),
  entry("holdout-10", "1. 青禾学校下周进行消防接口联调", [
    item("下周", "task", "todo"),
  ]),
  entry("holdout-11", "1. 青禾学校明天继续核对资产编码", [
    item("明天", "task", "todo"),
  ]),
  entry("holdout-12", "1. 青禾学校计划周四培训物业人员", [
    item("周四", "task", "todo"),
  ]),
  entry("holdout-13", "1. 青禾学校下周安排李强检查水表", [
    item("检查水表", "task", "todo", "李强"),
  ]),
  entry("holdout-14", "1. 青禾学校取消下周门禁培训", [
    item("取消", "update", "in_progress"),
  ]),
  entry(
    "holdout-15",
    "1. 青禾学校网关升级已完成\n2. 青禾学校明天检查离线探头",
    [item("网关升级"), item("离线探头", "task", "todo")],
  ),
  entry(
    "holdout-16",
    "1. 青禾学校与甲方确认验收资料\n2. 青禾学校下周提交竣工图",
    [item("验收资料"), item("竣工图", "task", "todo")],
  ),
  entry("holdout-17", "1. 青禾学校由李强完成点位复核", [
    item("点位复核", "update", "done", "李强"),
  ]),
  entry(
    "holdout-18",
    "1. 青禾学校现场复测已完成\n2. 青禾学校调试受阻，等待客户审批",
    [item("现场复测"), item("等待客户审批", "update", "blocked")],
  ),
  {
    ...entry("holdout-19", "1. 青禾学校照明回路核对已完成", [item("照明回路")]),
    source:
      "陈晨\nReport to:赵经理\n2026年10月12日\n今日工作总结\n1. 青禾学校照明回路核对已完成",
    workDate: "2026-10-12",
  },
  entry("holdout-20", "1. 青禾学校完成浏览器升级，下周更换值班室电脑", [
    item("完成浏览器升级"),
    item("下周更换值班室电脑", "task", "todo"),
  ]),
];
