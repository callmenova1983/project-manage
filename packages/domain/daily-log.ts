import { z } from "zod";
import {
  dateSchema,
  projectInput,
  type Project,
  type Snapshot,
} from "./types.js";
import { meetingReplyProjects } from "./meeting-completion.js";
import { checkProjectCatalog } from "./admin.js";
export const dailyLogRow = z
  .object({
    sourceLine: z.number().int().positive(),
    text: z.string().trim().min(1).max(4000),
    projectId: z.string().optional(),
    projectVersion: z.number().int().positive().optional(),
    newProjectName: z.string().trim().max(120).optional(),
    later: z.boolean(),
  })
  .strict();
export const dailyLogInput = z
  .object({
    batchId: z.string().uuid().optional(),
    source: z.string().min(1).max(12000),
    workDate: dateSchema,
    reporter: z.string().trim().min(1).max(80),
    rows: z.array(dailyLogRow).min(1).max(100),
    confirmed: z.literal(true),
  })
  .strict();
export type DailyLogInput = z.infer<typeof dailyLogInput>;
export interface DailyLogBatch {
  id: string;
  source: string;
  workDate: string;
  reporter: string;
  createdAt: string;
  rows: (z.infer<typeof dailyLogRow> & { status: "recorded" | "pending" })[];
}
const normalized = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "").replace(/项目$/, "");
export function parseDailyLog(source: string, projects: Project[]) {
  return source.split(/\r?\n/).flatMap((raw, index) => {
    const line = raw.replace(/^\s*(?:[-•]|\d+\s*[.、)）])\s*/, "").trim();
    if (!line) return [];
    const split = line.match(/^([^\s：:，,；;]{1,60})[\s：:]+([\s\S]+)$/);
    const name = split?.[1] ?? "",
      text = split?.[2]?.trim() || line;
    const active = projects.filter((project) => !project.intakeInbox);
    let matches = meetingReplyProjects(name || line, active);
    if (!matches.length && name)
      matches = active.filter((project) =>
        [project.name, project.shortName ?? "", ...project.aliases].some(
          (label) => normalized(label).includes(normalized(name)),
        ),
      );
    return [
      {
        sourceLine: index + 1,
        text,
        name,
        matches,
        projectId: matches.length === 1 ? matches[0]!.id : "",
        projectVersion: matches.length === 1 ? matches[0]!.version : undefined,
        newProjectName: matches.length ? "" : name,
        later: !name || matches.length > 1,
      },
    ];
  });
}
export function looksLikeDailyLog(source: string) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  return (
    lines.length >= 2 &&
    lines.every((line) =>
      /^\s*\d+\s*[.、)）]\s*[^\s：:，,；;]+[\s：:]+\S/.test(line),
    )
  );
}
export const missingProjectFields = (
  project: Pick<Project, "owner" | "stage">,
) =>
  [
    !project.owner.trim() || project.owner.trim() === "Unassigned"
      ? "负责人"
      : "",
    project.stage === "unclassified" ? "阶段" : "",
  ].filter(Boolean);
export function planDailyLog(
  raw: DailyLogInput,
  snapshot: Snapshot,
  previous?: DailyLogBatch,
) {
  const input = dailyLogInput.parse(raw);
  if (
    previous &&
    (previous.source !== input.source ||
      previous.workDate !== input.workDate ||
      previous.reporter !== input.reporter)
  )
    throw new Error("已保存日志的原文、日期和记录人不能改写，请新建一份日志。");
  const sourceLines = input.source.split(/\r?\n/);
  if (
    new Set(input.rows.map((row) => row.sourceLine)).size !== input.rows.length
  )
    throw new Error("同一行日志不能重复归档。");
  const prior = previous?.rows ?? [];
  const projects = snapshot.projects.map((project) => ({ ...project }));
  const created: Project[] = [];
  const grouped = new Map<
    string,
    { before: Project; rows: z.infer<typeof dailyLogRow>[] }
  >();
  const receipt: DailyLogBatch = {
    id: previous?.id ?? crypto.randomUUID(),
    source: input.source,
    workDate: input.workDate,
    reporter: input.reporter,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    rows: prior
      .filter(
        (row) => !input.rows.some((next) => next.sourceLine === row.sourceLine),
      )
      .map((row) => ({ ...row })),
  };
  for (const row of input.rows) {
    if (
      !sourceLines[row.sourceLine - 1]?.trim() ||
      prior.some(
        (old) => old.sourceLine === row.sourceLine && old.status === "recorded",
      )
    )
      throw new Error("这行原文不存在或已归档，请刷新后重试。");
    if (row.later) {
      receipt.rows.push({ ...row, status: "pending" });
      continue;
    }
    let project = row.projectId
      ? projects.find(
          (project) => project.id === row.projectId && !project.intakeInbox,
        )
      : undefined;
    if (row.projectId && (!project || project.version !== row.projectVersion))
      throw new Error("项目已有新修改，请刷新批量预览后重试。");
    if (!row.projectId) {
      const name = row.newProjectName?.trim();
      if (!name) throw new Error("请明确项目名称或选择稍后归类。");
      project = created.find(
        (project) => normalized(project.name) === normalized(name),
      );
      if (!project) {
        if (
          snapshot.projects.some((project) =>
            [project.name, project.shortName ?? "", ...project.aliases].some(
              (label) => label && normalized(label) === normalized(name),
            ),
          )
        )
          throw new Error(`已有“${name}”项目，请选择已有项目。`);
        project = {
          ...projectInput.parse({
            name,
            channelId: "company",
            client: "",
            description: "",
            stage: "unclassified",
            owner: "",
            discipline: "Unassigned",
            latestUpdate: "",
            notes: "",
            aliases: [],
          }),
          id: crypto.randomUUID(),
          version: 1,
          updatedAt: new Date().toISOString(),
          reportedAt: null,
          reportedBy: null,
        };
        created.push(project);
        projects.push(project);
      }
    }
    const group = grouped.get(project!.id) ?? { before: project!, rows: [] };
    group.rows.push(row);
    grouped.set(project!.id, group);
    receipt.rows.push({ ...row, projectId: project!.id, status: "recorded" });
  }
  const changes = [...grouped.values()].map((group) => {
    const latestUpdate = group.rows.map((row) => row.text).join("\n");
    if (latestUpdate.length > 4000)
      throw new Error("同一项目的日志超过4000字，请分批归档。");
    const after = {
      ...group.before,
      latestUpdate,
      reportedAt: new Date().toISOString(),
      reportedBy: input.reporter,
      version: group.before.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return {
      before: group.before,
      after,
      sourceLines: group.rows.map((row) => row.sourceLine),
    };
  });
  receipt.rows.sort((a, b) => a.sourceLine - b.sourceLine);
  return { receipt, created, changes };
}
export const bulkProjectInput = z
  .object({
    rows: z
      .array(
        z
          .object({
            id: z.string().min(1),
            version: z.number().int().positive(),
            fields: projectInput
              .pick({ owner: true, stage: true, client: true, channelId: true })
              .partial(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type BulkProjectInput = z.infer<typeof bulkProjectInput>;
export function planBulkProjectFill(raw: BulkProjectInput, snapshot: Snapshot) {
  const input = bulkProjectInput.parse(raw);
  if (new Set(input.rows.map((row) => row.id)).size !== input.rows.length)
    throw new Error("项目不能重复选择。");
  return input.rows.map((row) => {
    const before = snapshot.projects.find(
      (project) => project.id === row.id && !project.intakeInbox,
    );
    if (!before || before.version !== row.version)
      throw new Error("项目已有新修改，请刷新批量预览后重试。");
    const fields = Object.fromEntries(
      Object.entries(row.fields).filter(([, value]) => value !== undefined),
    );
    const after = {
      ...before,
      ...fields,
      ...(fields.owner !== undefined && fields.owner !== before.owner
        ? { ownerId: null }
        : {}),
      version: before.version + 1,
      updatedAt: new Date().toISOString(),
    };
    projectInput.strip().parse(after);
    if (snapshot.catalogs)
      checkProjectCatalog(after, snapshot.catalogs, before);
    return { before, after };
  });
}
