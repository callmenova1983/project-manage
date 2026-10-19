import { z } from "zod";
import type { Actor, Snapshot } from "./types.js";
import { createTaskViewIndex } from "./task-view.js";

export const assistantSessionInput = z
  .object({
    version: z.number().int().nonnegative(),
    state: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AssistantSession = {
  version: number;
  updatedAt: string | null;
  state: Record<string, unknown>;
};
export const assistantQueryInput = z
  .object({
    text: z.string().trim().min(1).max(2000),
    locale: z.enum(["en", "zh-CN"]).optional(),
    projectId: z.string().max(100).nullable().optional(),
  })
  .strict();
export type AssistantQueryInput = z.infer<typeof assistantQueryInput>;
export type AssistantAnswer = {
  handled: boolean;
  text: string;
  links: { title: string; detail: string; path: string }[];
};

/** A read-only, source-backed first-stage query tool. Commands never mutate here. */
export function answerAssistantQuery(
  input: AssistantQueryInput,
  snapshot: Snapshot,
  actor: Pick<Actor, "id" | "name">,
  now = new Date(),
): AssistantAnswer {
  const text = input.text.trim();
  const en = input.locale === "en";
  const label = (zh: string, english: string) => (en ? english : zh);
  const unhandled: AssistantAnswer = { handled: false, text: "", links: [] };
  // A structured note may contain words like “进展/情况”; those are not queries.
  if (/^\s*#{1,6}\s+.+/m.test(text) && /^\s*[-*•]\s+\S/m.test(text))
    return unhandled;
  const asking =
    /\?|？|哪些|多少|怎么样|如何|情况|进展|查询|查一下|查找|列出|看看|搜索|有什么|要做什么|待办|what|which|show|list|find|status of/i.test(
      text,
    );
  if (
    /新建|新增|创建|改成|改为|修改|分配|设置|设为|标记|归档|作废|删除|记录一下|(?:把|将).{0,100}分给|create |add |assign |change /i.test(
      text,
    ) ||
    (!asking && /分给|完成了|已完成/i.test(text))
  )
    return unhandled;
  if (!asking) return unhandled;
  const projects = snapshot.projects.filter((p) => !p.intakeInbox);
  const matches = projects.filter((p) =>
    [p.name, p.shortName, ...p.aliases].some(
      (name) =>
        name &&
        name.length >= 2 &&
        text.toLowerCase().includes(name.toLowerCase()),
    ),
  );
  // Prefer the longest explicit name; only use page context when no name occurs.
  const ranked = matches.map((p) => ({
    p,
    length: Math.max(
      ...[p.name, p.shortName, ...p.aliases]
        .filter(
          (n): n is string =>
            !!n && text.toLowerCase().includes(n.toLowerCase()),
        )
        .map((n) => n.length),
    ),
  }));
  const longest = Math.max(0, ...ranked.map((p) => p.length));
  const explicit = ranked.filter((p) => p.length === longest).map((p) => p.p);
  if (explicit.length > 1)
    return {
      handled: true,
      text: label(
        "找到了多个同名项目，你指的是哪一个？",
        "Several projects have this name. Which one do you mean?",
      ),
      links: explicit.map((p) => ({
        title: p.name,
        detail: label("选择项目后继续问我", "Select a project, then ask again"),
        path: `/projects/${encodeURIComponent(p.id)}`,
      })),
    };
  const global = /所有项目|全部项目|整个工作区|全工作区|all projects/i.test(
    text,
  );
  const project =
    explicit[0] ??
    (!global ? projects.find((p) => p.id === input.projectId) : undefined);
  const scope: "today" | "week" | "all" = /今天|today/i.test(text)
    ? "today"
    : /本周|这周|this week/i.test(text)
      ? "week"
      : "all";
  const statuses = {
    todo: label("待做", "To do"),
    in_progress: label("进行中", "In progress"),
    done: label("已完成", "Done"),
    blocked: label("待协调", "Needs coordination"),
  };
  const index = createTaskViewIndex(snapshot.tasks, {
    now,
    timeZone: snapshot.settings?.timeZone ?? "UTC",
    members: snapshot.members,
    actorId: actor.id,
  });
  const open =
    /未完成|待办|待做|要做|open|todo|to do|unfinished|not completed/i.test(
      text,
    );
  const done = !open && /已完成|完成了|完成的|completed|finished/i.test(text);
  const query = {
    scope,
    status: "" as const,
    project: project?.id ?? "",
    query: "",
    focus: done
      ? ("done" as const)
      : open || scope !== "all"
        ? ("open" as const)
        : ("all" as const),
    assignee: /我的|我负责|分给我|my tasks|assigned to me/i.test(text)
      ? "me"
      : "",
    risk: /逾期|超期|overdue/i.test(text)
      ? "overdue"
      : /待协调|受阻|blocked/i.test(text)
        ? "blocked"
        : "",
  };
  if (
    project &&
    /进展|情况|状态|怎么样|status|progress/i.test(text) &&
    !/任务|待办|task/i.test(text)
  ) {
    const tasks = index.select({ ...query, scope: "all", focus: "all" });
    return {
      handled: true,
      text: en
        ? `${project.shortName || project.name}: ${project.latestUpdate || "No progress recorded yet."}\nOwner: ${project.owner || "Unassigned"}; ${tasks.filter((t) => t.status !== "done").length} open tasks, ${tasks.filter((t) => t.status === "done").length} completed.`
        : `${project.shortName || project.name}：${project.latestUpdate || "尚未记录进展。"}\n负责人：${project.owner || "未分配"}；未完成 ${tasks.filter((t) => t.status !== "done").length} 项，已完成 ${tasks.filter((t) => t.status === "done").length} 项。`,
      links: [
        {
          title: label(
            "查看项目与进展记录",
            "View project and progress history",
          ),
          detail: label(
            "来自当前工作区实际记录",
            "From current workspace records",
          ),
          path: `/projects/${encodeURIComponent(project.id)}`,
        },
      ],
    };
  }
  if (
    /项目|projects/i.test(text) &&
    !project &&
    !/任务|待办|待做|逾期|task|todo/i.test(text)
  )
    return {
      handled: true,
      text: en
        ? `There are ${projects.length} projects in this workspace.`
        : `工作区共有 ${projects.length} 个项目。`,
      links: projects.slice(0, 20).map((p) => ({
        title: p.shortName || p.name,
        detail:
          p.latestUpdate ||
          (en
            ? `Owner: ${p.owner || "Unassigned"}`
            : `负责人：${p.owner || "未分配"}`),
        path: `/projects/${encodeURIComponent(p.id)}`,
      })),
    };
  if (
    !/任务|待办|待做|工作|要做|逾期|待协调|task|todo|work|overdue/i.test(text)
  )
    return {
      handled: true,
      text: label(
        "可以直接问我项目进展、今天／本周待办、负责人和逾期任务，也可以粘贴记录或附件让我整理。",
        "Ask about project progress, today’s or this week’s tasks, owners and overdue work. You can also paste notes or attachments to organize.",
      ),
      links: [],
    };
  const tasks = index.select(query);
  const prefix = `${project ? project.shortName || project.name : label("工作区", "Workspace")}${scope === "today" ? label("今天", " today") : scope === "week" ? label("本周", " this week") : ""}`;
  return {
    handled: true,
    text: en
      ? `${prefix}: ${tasks.length} ${query.focus === "open" ? "open " : query.focus === "done" ? "completed " : ""}tasks found.${tasks.length > 20 ? " Showing the first 20." : ""}\nFiltered by planned work; due dates are tracked separately.`
      : `${prefix}找到 ${tasks.length} 项${query.focus === "open" ? "未完成" : query.focus === "done" ? "已完成" : ""}任务。${tasks.length > 20 ? "先显示前 20 项。" : ""}\n按工作安排查询；截止日期独立统计。`,
    links: tasks.slice(0, 20).map((t) => ({
      title: t.title,
      detail: `${projects.find((p) => p.id === t.projectId)?.shortName || projects.find((p) => p.id === t.projectId)?.name || label("项目", "Project")} · ${statuses[t.status]} · ${t.assignee || label("未分配", "Unassigned")}${t.dueDate ? ` · ${label("截止", "Due")} ${t.dueDate}` : ""}`,
      path: `/projects/${encodeURIComponent(t.projectId)}?task=${encodeURIComponent(t.id)}`,
    })),
  };
}
