import type { IntakeField } from "./intake.js";
export function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}
export const fieldAliases: Record<Exclude<IntakeField, "ignore">, string[]> = {
  project: [
    "project",
    "project name",
    "name",
    "项目",
    "项目名称",
    "项目名",
    "项目名字",
    "新建项目",
    "创建项目",
  ],
  channel: ["channel", "渠道", "项目渠道", "渠道方"],
  shortName: ["short name", "shortname", "简称", "项目简称"],
  aliases: ["aliases", "alias", "别名", "项目别名"],
  client: ["client", "customer", "客户", "客户名称", "客户名字", "客户名"],
  address: ["address", "location", "地址", "项目地址", "所在地", "项目所在地"],
  owner: ["owner", "project owner", "负责人", "项目负责人"],
  stage: ["stage", "phase", "阶段", "项目阶段"],
  task: ["task", "todo", "task title", "任务", "待办", "事项"],
  assignee: ["assignee", "task owner", "执行人", "任务负责人"],
  dueDate: ["due", "due date", "deadline", "截止", "截止日期", "日期"],
  status: ["status", "task status", "状态", "任务状态"],
  description: ["description", "notes", "描述", "备注"],
};
