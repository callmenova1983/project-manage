/** Synthetic regression corpus for old/new pipeline comparisons, not a held-out
 * accuracy benchmark. Labels are business expectations, independent of parser output. */
export interface ExpectedReportItem {
  action: "task" | "update";
  status: "todo" | "done" | "blocked" | "in_progress";
  contains: string;
  assignee: string;
}
export interface ReportEvaluationCase {
  id: string;
  category: string;
  source: string;
  items: ExpectedReportItem[];
  workDate?: string;
  invalidWorkDate?: true;
}
const header = "李明\nReport to:王华\n今日工作总结\n";
const update = (
  contains: string,
  status: ExpectedReportItem["status"] = "done",
  assignee = "李明",
): ExpectedReportItem => ({ action: "update", status, contains, assignee });
const task = (contains: string, assignee = "李明"): ExpectedReportItem => ({
  action: "task",
  status: "todo",
  contains,
  assignee,
});
const entry = (
  id: string,
  category: string,
  text: string,
  items: ExpectedReportItem[],
): ReportEvaluationCase => ({ id, category, source: header + text, items });

export const dailyReportEvaluation: ReportEvaluationCase[] = [
  entry("done-1", "当日事实", "1. 示例学校二期离线设备排查", [
    update("离线设备排查"),
  ]),
  entry("done-2", "当日事实", "1. 示例学校新增开关面板加入及BMS打点", [
    update("BMS打点"),
  ]),
  entry("done-3", "当日事实", "1. 示例学校空调和人体传感器调整", [
    update("人体传感器调整"),
  ]),
  entry("done-4", "当日事实", "1. 沟通示例项目运维流程，整理问题清单", [
    update("整理问题清单"),
  ]),
  entry("done-5", "当日事实", "1. 示例项目现场培训已完成", [
    update("培训已完成"),
  ]),
  entry("open-1", "未完成原因", "1. 示例项目设备仍在排查，尚未完成", [
    update("尚未完成", "in_progress"),
  ]),
  entry("open-2", "未完成原因", "1. 示例项目上线受阻，等待客户审批", [
    update("等待客户审批", "blocked"),
  ]),
  entry("open-3", "未完成原因", "1. 示例项目传感器尚未修复", [
    update("尚未修复", "in_progress"),
  ]),
  entry("open-4", "未完成原因", "1. 示例项目网络无法连接", [
    update("无法连接", "blocked"),
  ]),
  entry("open-5", "未完成原因", "1. 示例项目联调部分完成", [
    update("部分完成", "in_progress"),
  ]),
  entry("future-1", "后续安排", "1. 示例项目下周培训", [task("下周培训")]),
  entry("future-2", "后续安排", "1. 示例项目明天继续排查", [
    task("明天继续排查"),
  ]),
  entry("future-3", "后续安排", "1. 示例项目下周预计更换电脑", [
    task("下周预计更换电脑"),
  ]),
  entry("future-4", "后续安排", "下周工作计划\n1. 示例项目现场培训", [
    task("现场培训"),
  ]),
  entry("future-5", "后续安排", "1. 示例项目取消下周培训", [
    update("取消下周培训", "in_progress"),
  ]),
  entry("mixed-1", "当天及未来", "1. 示例项目更新浏览器，下周预计更换电脑", [
    update("更新浏览器"),
    task("下周预计更换电脑"),
  ]),
  entry("mixed-2", "当天及未来", "1. 示例项目配置未完成，明天继续排查", [
    update("配置未完成", "in_progress"),
    task("明天继续排查"),
  ]),
  entry(
    "mixed-3",
    "当天及未来",
    "1. 示例项目沟通自动化设置，线上培训预约下周时间",
    [update("沟通自动化设置"), task("预约下周时间")],
  ),
  entry("mixed-4", "当天及未来", "1. 示例项目确认设备清单；下周安装设备", [
    update("确认设备清单"),
    task("下周安装设备"),
  ]),
  entry(
    "mixed-5",
    "当天及未来",
    "1. 示例项目今日完成调试\n2. 下周检查运行情况",
    [update("完成调试"), task("下周检查运行情况")],
  ),
  entry("owner-1", "人员归属", "1. 示例项目由陈林负责下周培训", [
    task("下周培训", "陈林"),
  ]),
  entry("owner-2", "人员归属", "1. 示例项目完成检查，明天复查，由陈林负责", [
    update("完成检查"),
    task("明天复查", "陈林"),
  ]),
  entry(
    "owner-3",
    "人员归属",
    "1. 示例项目完成点位确认\n张珊\nReport to:赵青\n今日工作总结\n1. 示例项目下周培训",
    [update("点位确认"), task("下周培训", "张珊")],
  ),
  {
    id: "owner-4",
    category: "人员归属",
    source:
      "汇报人：张珊\nReport to:王华\n今日工作总结\n1. 示例项目完成现场培训",
    items: [update("现场培训", "done", "张珊")],
  },
  entry("owner-5", "人员归属", "1. 示例项目由陈林负责完成检查", [
    update("完成检查", "done", "陈林"),
  ]),
  {
    ...entry("date-1", "日期依据", "1. 示例项目完成检查", [update("完成检查")]),
    source: "2026-10-17\n" + header + "1. 示例项目完成检查",
    workDate: "2026-10-17",
  },
  {
    ...entry("date-2", "日期依据", "1. 示例项目下周培训", [task("下周培训")]),
    source: "2026-12-31\n" + header + "1. 示例项目下周培训",
    workDate: "2026-12-31",
  },
  {
    ...entry("date-3", "日期依据", "1. 示例项目完成检查", [update("完成检查")]),
    source: "2028-02-29\n" + header + "1. 示例项目完成检查",
    workDate: "2028-02-29",
  },
  {
    ...entry("date-4", "日期依据", "1. 示例项目完成检查", [update("完成检查")]),
    source: "2026-02-30\n" + header + "1. 示例项目完成检查",
    invalidWorkDate: true,
  },
  entry("date-5", "日期依据", "1. 示例项目下周预计培训", [
    task("下周预计培训"),
  ]),
];
