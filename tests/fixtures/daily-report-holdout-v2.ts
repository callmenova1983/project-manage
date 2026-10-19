import type {
  ReportEvaluationCase,
  ExpectedReportItem,
} from "./daily-report-evaluation.js";

// Second synthetic acceptance set. Freeze before execution, never relabel to
// match results. This is not an independently sampled production dataset.
const fact = (
  contains: string,
  status: ExpectedReportItem["status"] = "done",
  assignee = "周宁",
): ExpectedReportItem => ({ contains, action: "update", status, assignee });
const plan = (contains: string, assignee = "周宁"): ExpectedReportItem => ({
  contains,
  action: "task",
  status: "todo",
  assignee,
});
const sample = (
  id: number,
  text: string,
  items: ExpectedReportItem[],
  date?: string,
): ReportEvaluationCase => ({
  id: `independent-v2-${id}`,
  category: "synthetic-v2",
  source: `周宁\nReport to:孙主管\n${date ? `${date}\n` : ""}今日工作总结\n${text}`,
  items,
  ...(date ? { workDate: "2026-10-16" } : {}),
});
export const dailyReportHoldoutV2: ReportEvaluationCase[] = [
  sample(1, "1. 青禾学校与总包沟通弱电间进场路线", [fact("进场路线")]),
  sample(2, "1. 青禾学校汇总楼层交换机序列号", [fact("序列号")]),
  sample(3, "1. 青禾学校热量表读数复核已完成", [fact("热量表")]),
  sample(4, "1. 青禾学校向客户解释告警分级方式", [fact("告警分级")]),
  sample(5, "1. 青禾学校修改账户权限，剩余两个账户尚未完成", [
    fact("尚未完成", "in_progress"),
  ]),
  sample(6, "1. 青禾学校广播测试受阻，等待施工方恢复供电", [
    fact("恢复供电", "blocked"),
  ]),
  sample(7, "1. 青禾学校清单核对仍在进行中", [fact("进行中", "in_progress")]),
  sample(8, "1. 青禾学校现场联调暂停，等待供应商提供驱动", [
    fact("提供驱动", "blocked"),
  ]),
  sample(9, "1. 青禾学校明日导出网络拓扑图", [plan("网络拓扑图")]),
  sample(10, "1. 青禾学校下星期安装备用电源", [plan("备用电源")]),
  sample(11, "1. 青禾学校约定星期四到场培训", [plan("星期四")]),
  sample(12, "1. 青禾学校下个月复查电池健康状态", [plan("电池健康")]),
  sample(13, "1. 青禾学校由王敏负责导出巡检日志", [
    fact("巡检日志", "done", "王敏"),
  ]),
  sample(14, "1. 青禾学校后续安排何平提交设备台账", [plan("设备台账", "何平")]),
  sample(15, "1. 青禾学校由赵磊完成广播回路核验", [
    fact("回路核验", "done", "赵磊"),
  ]),
  sample(16, "1. 青禾学校取消明天的远程培训", [fact("取消", "in_progress")]),
  sample(17, "1. 青禾学校摄像机升级已完成\n2. 青禾学校下周检查录像保存周期", [
    fact("摄像机升级"),
    plan("保存周期"),
  ]),
  sample(
    18,
    "1. 青禾学校与厂商确认驱动版本\n2. 青禾学校数据采集受阻，等待客户开通网络",
    [fact("驱动版本"), fact("开通网络", "blocked")],
  ),
  sample(
    19,
    "1. 青禾学校出入口联动测试已完成",
    [fact("联动测试")],
    "2026年10月16日",
  ),
  sample(20, "1. 青禾学校机柜标签已核对，下周安排王敏检查接地", [
    fact("机柜标签"),
    plan("检查接地", "王敏"),
  ]),
];
