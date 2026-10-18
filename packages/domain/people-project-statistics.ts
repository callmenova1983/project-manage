import { pinyin } from "pinyin-pro";
import {
  createTaskViewIndex,
  taskAssigneeKey,
  taskIsOverdue,
  type TaskViewContext,
} from "./task-view.js";
import type { Project, Snapshot, Task } from "./types.js";
import type { StatisticsQuery } from "./statistics-query.js";
export interface StatisticsGroup {
  key: string;
  name: string;
  projects: Project[];
  tasks: Task[];
  total: number;
  open: number;
  done: number;
  blocked: number;
  overdue: number;
}
const names = new Map<string, string>();
function searchable(name: string) {
  let value = names.get(name);
  if (!value) {
    const words = pinyin(name, { type: "array", toneType: "none" });
    value = [name, words.join(""), words.map((w) => w[0]).join("")]
      .join(" ")
      .toLowerCase();
    if (names.size > 5000) names.clear();
    names.set(name, value);
  }
  return value;
}
const collator = new Intl.Collator("zh-CN-u-co-pinyin", { numeric: true });
function metric(group: StatisticsGroup, key: string): number | string {
  if (key === "projects") return group.projects.length;
  if (key === "name") return group.name;
  return group[key as "total" | "open" | "done" | "blocked" | "overdue"];
}
export function compareStatistics(
  a: StatisticsGroup,
  b: StatisticsGroup,
  query: StatisticsQuery,
) {
  if (a.key === "none" || b.key === "none")
    return a.key === b.key ? 0 : a.key === "none" ? 1 : -1;
  const primary =
    query.sort || (query.preset === "attention" ? "" : query.preset);
  const fields = [
    ...(primary ? [primary] : []),
    "overdue",
    "blocked",
    "open",
    "projects",
    "name",
  ];
  for (const field of [...new Set(fields)]) {
    const av = metric(a, field),
      bv = metric(b, field);
    const direction =
      field === primary
        ? query.sort
          ? query.direction
          : field === "name"
            ? "asc"
            : "desc"
        : field === "name"
          ? "asc"
          : "desc";
    const result =
      typeof av === "string" && typeof bv === "string"
        ? collator.compare(av, bv)
        : Number(av) - Number(bv);
    if (result) return result * (direction === "asc" ? 1 : -1);
  }
  return a.key.localeCompare(b.key);
}
export function projectStatistics(
  snapshot: Snapshot,
  query: StatisticsQuery,
  context: TaskViewContext = {},
) {
  const index = createTaskViewIndex(snapshot.tasks, context);
  const projects = snapshot.projects.filter(
    (p) =>
      (!query.projects.length || query.projects.includes(p.id)) &&
      (!query.stages.length || query.stages.includes(p.stage || "missing")),
  );
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const members = new Map((snapshot.members ?? []).map((m) => [m.id, m.name]));
  const leaves = index
    .select({ scope: "all", status: "", project: "", query: "", focus: "all" })
    .filter((t) => projectMap.has(t.projectId));
  const groups = new Map<string, StatisticsGroup>();
  const ensure = (key: string, name: string) => {
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name,
        projects: [],
        tasks: [],
        total: 0,
        open: 0,
        done: 0,
        blocked: 0,
        overdue: 0,
      };
      groups.set(key, group);
    }
    return group;
  };
  const ownerKey = (p: Project) =>
    p.ownerId
      ? `member:${p.ownerId}`
      : p.owner.trim()
        ? `text:${p.owner.trim()}`
        : "none";
  if (query.view === "projects")
    for (const p of projects) {
      ensure(
        ownerKey(p),
        (p.ownerId && members.get(p.ownerId)) ||
          p.owner.trim() ||
          "未填写负责人",
      ).projects.push(p);
    }
  for (const task of leaves) {
    const p = projectMap.get(task.projectId)!;
    const key = query.view === "projects" ? ownerKey(p) : taskAssigneeKey(task);
    const group =
      query.view === "projects"
        ? groups.get(key)!
        : ensure(
            key,
            (task.assigneeId && members.get(task.assigneeId)) ||
              (key === "none" ? "未分配任务" : task.assignee.trim()),
          );
    group.tasks.push(task);
    if (
      query.view === "tasks" &&
      !group.projects.some((item) => item.id === p.id)
    )
      group.projects.push(p);
    group.total++;
    group[task.status === "done" ? "done" : "open"]++;
    if (task.status === "blocked") group.blocked++;
    if (taskIsOverdue(task, index.today)) group.overdue++;
  }
  const rows = [...groups.values()]
    .filter(
      (g) =>
        (!query.unassigned || g.key === "none") &&
        (!query.search.trim() ||
          searchable(g.name).includes(query.search.trim().toLowerCase())) &&
        (query.attention === "all" || g[query.attention] > 0),
    )
    .sort((a, b) => compareStatistics(a, b, query));
  const totals = {
    projects: 0,
    total: 0,
    open: 0,
    done: 0,
    blocked: 0,
    overdue: 0,
  };
  const ids = new Set<string>();
  for (const row of rows) {
    row.projects.forEach((p) => ids.add(p.id));
    for (const key of ["total", "open", "done", "blocked", "overdue"] as const)
      totals[key] += row[key];
  }
  totals.projects = ids.size;
  return { rows, totals, today: index.today };
}
export function statisticsTasks(
  group: StatisticsGroup,
  kind: "total" | "open" | "done" | "blocked" | "overdue",
  today: string,
) {
  return group.tasks.filter(
    (t) =>
      kind === "total" ||
      (kind === "open"
        ? t.status !== "done"
        : kind === "overdue"
          ? taskIsOverdue(t, today)
          : t.status === kind),
  );
}
