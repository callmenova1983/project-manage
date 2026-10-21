import { z } from "zod";
import {
  dateSchema,
  type Proposal,
  type Project,
  type Snapshot,
  type Actor,
} from "./types.js";
import { createTaskViewIndex } from "./task-view.js";
import type { AssistantAnswer } from "./assistant.js";
import { captureSourceSchema } from "./capture.js";

export const assistantTurnInput = z
  .object({
    source: z.string().trim().min(1).max(12000),
    externalProcessingConfirmed: z.literal(true),
    originalSource: captureSourceSchema.optional(),
    temporaryMaterialIds: z.array(z.string().uuid()).max(6).optional(),
    contextProjectId: z.string().max(100).optional(),
    pendingProposalId: z.string().max(100).optional(),
    draft: z.string().max(12000).optional(),
    recentMessages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            text: z.string().max(2000),
            projectIds: z.array(z.string().max(100)).max(50),
          })
          .strict(),
      )
      .max(6)
      .optional(),
  })
  .strict();
export type AssistantTurnInput = z.infer<typeof assistantTurnInput>;
const field = z.string().trim().min(1).max(120);
export const assistantProjectRow = z
  .object({
    projectId: z.string().max(100).nullable(),
    name: field,
    client: field.optional(),
    owner: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    channel: field.optional(),
    stage: field.optional(),
    shortName: z.string().max(80).optional(),
    description: z.string().max(4000).optional(),
    task: z.string().trim().min(1).max(240).optional(),
    assignee: z.string().max(80).optional(),
    dueDate: z.string().max(10).optional(),
    quote: z.string().trim().min(1).max(12000),
  })
  .strict();
export const assistantPlanSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("project"),
      rows: z.array(assistantProjectRow).min(1).max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("work"),
      items: z
        .array(
          z
            .object({
              // A source quote is authoritative; providers need not count report headings/blank lines.
              sourceLine: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .optional()
                .default(1),
              quote: z.string().trim().min(1).max(12000),
              title: z.string().trim().min(1).max(240),
              projectIds: z.array(z.string().max(100)).max(5),
              projectName: field.optional(),
              action: z.enum(["task", "update"]),
              status: z.enum(["todo", "in_progress", "done", "blocked"]),
              assignee: z.string().max(80).optional(),
              dailyReport: z.boolean().optional(),
              reporter: z.string().trim().min(1).max(80).optional(),
              reportTo: z.string().trim().min(1).max(80).optional(),
              workDate: dateSchema.optional(),
              workWeek: dateSchema.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("query"),
      entity: z.enum(["projects", "tasks"]),
      projectIds: z.array(z.string().max(100)).max(100),
      status: z.enum([
        "all",
        "open",
        "todo",
        "in_progress",
        "done",
        "blocked",
        "overdue",
      ]),
      range: z.enum(["all", "today", "week"]),
      owner: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("resolve"),
      action: z.enum(["assign", "skip", "defer", "cancel"]),
      projectId: z.string().max(100).nullable(),
      suggestionIds: z.array(z.string().max(100)).max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clarify"),
      question: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;
export type AssistantTurn = {
  plan: AssistantPlan;
  model: string;
  proposal?: Proposal;
  answer?: AssistantAnswer;
};

/** Execute typed read filters against actual records; never parse natural language. */
export function answerAssistantPlan(
  plan: Extract<AssistantPlan, { kind: "query" }>,
  snapshot: Snapshot,
  actor: Pick<Actor, "id" | "name">,
): AssistantAnswer {
  const projects = snapshot.projects.filter(
    (p) =>
      !p.intakeInbox &&
      (!plan.projectIds.length || plan.projectIds.includes(p.id)),
  );
  if (plan.entity === "projects") {
    const rows = projects.filter(
      (p) =>
        !plan.owner ||
        p.owner === (plan.owner === "me" ? actor.name : plan.owner),
    );
    return {
      handled: true,
      text: `找到 ${rows.length} 个项目。`,
      links: rows.slice(0, 50).map((p) => ({
        title: p.name,
        detail: `客户：${p.client || "未填写"} · 负责人：${p.owner || "未分配"}\n${p.latestUpdate || "尚未记录进展"}`,
        path: `/projects/${encodeURIComponent(p.id)}`,
      })),
    };
  }
  const index = createTaskViewIndex(snapshot.tasks, {
    members: snapshot.members,
    actorId: actor.id,
    timeZone: snapshot.settings?.timeZone ?? "UTC",
  });
  const tasks = index
    .select({
      scope: plan.range,
      focus:
        plan.status === "done"
          ? "done"
          : plan.status === "open"
            ? "open"
            : "all",
      status:
        plan.status === "todo" ||
        plan.status === "in_progress" ||
        plan.status === "done" ||
        plan.status === "blocked"
          ? plan.status
          : "",
      project: "",
      query: "",
      risk: plan.status === "overdue" ? "overdue" : "",
    })
    .filter(
      (task) =>
        projects.some((p) => p.id === task.projectId) &&
        (!plan.owner ||
          task.assignee === (plan.owner === "me" ? actor.name : plan.owner) ||
          (plan.owner === "me" && task.assigneeId === actor.id)),
    );
  return {
    handled: true,
    text: `找到 ${tasks.length} 项任务。`,
    links: tasks.slice(0, 50).map((task) => ({
      title: task.title,
      detail: `${projects.find((p) => p.id === task.projectId)?.name} · ${task.assignee || "未分配"}`,
      path: `/projects/${encodeURIComponent(task.projectId)}#task-${encodeURIComponent(task.id)}`,
    })),
  };
}

/** Serialization only. All names, field meanings and intent come from the model. */
export function assistantProjectCsv(
  rows: z.infer<typeof assistantProjectRow>[],
  projects: Project[],
) {
  const columns = [
    "project",
    "client",
    "owner",
    "address",
    "channel",
    "stage",
    "shortName",
    "description",
    "task",
    "assignee",
    "dueDate",
  ] as const;
  const encode = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    columns.map((c) =>
      c === "project"
        ? "Project"
        : c === "shortName"
          ? "short name"
          : c === "dueDate"
            ? "due date"
            : c,
    ),
    ...rows.map((row) => {
      const target = projects.find((p) => p.id === row.projectId);
      return columns.map((column) =>
        column === "project"
          ? (target?.name ?? row.name)
          : column === "client" && target
            ? target.client
            : (row[column] ?? ""),
      );
    }),
  ]
    .map((row) => row.map(encode).join(","))
    .join("\n");
}
