import { z } from "zod";
import {
  DomainError,
  projectInput,
  projectSchema,
  validateGraph,
  type Snapshot,
} from "./types.js";

export const projectRenameInput = z
  .object({
    name: projectInput.shape.name,
    shortName: projectInput.shape.shortName,
    version: z.number().int().positive(),
  })
  .strict();

export const projectMergeInput = z
  .object({
    targetId: z.string().min(1).max(100),
    sourceIds: z.array(z.string().min(1).max(100)).min(1).max(49),
    name: projectInput.shape.name,
    shortName: projectInput.shape.shortName,
    revision: z.number().int().positive(),
    confirmed: z.literal(true),
  })
  .strict();
export type ProjectMergeInput = z.infer<typeof projectMergeInput>;

export class ProjectMergeConflict extends Error {}

/** Plan the whole change before either adapter writes any records. */
export function planProjectMerge(
  snapshot: Snapshot,
  raw: ProjectMergeInput,
  now = new Date().toISOString(),
) {
  const input = projectMergeInput.parse(raw);
  if (snapshot.revision !== input.revision)
    throw new ProjectMergeConflict(
      "Workspace changed. Refresh the merge preview and try again.",
    );
  if (
    new Set(input.sourceIds).size !== input.sourceIds.length ||
    input.sourceIds.includes(input.targetId)
  )
    throw new DomainError(
      "Choose distinct source projects other than the retained project.",
    );
  const target = snapshot.projects.find((p) => p.id === input.targetId);
  const sources = input.sourceIds.map((id) =>
    snapshot.projects.find((p) => p.id === id),
  );
  if (!target || sources.some((p) => !p))
    throw new DomainError(
      "A selected project no longer exists in this workspace.",
    );
  const incoming = sources.filter((p) => p !== undefined);
  const all = [target, ...incoming];
  if (all.some((p) => p.intakeInbox))
    throw new DomainError("Unassigned work cannot be merged as a project.");
  const aliases = [
    ...new Set(all.flatMap((p) => [p.name, p.shortName ?? "", ...p.aliases])),
  ].filter((name) => !!name && name !== input.name && name.length <= 80);
  const notes = [
    target.notes,
    ...incoming.map((p) =>
      [
        `【合并来源：${p.name}】`,
        p.shortName ? `原简称：${p.shortName}` : "",
        `客户：${p.client || "未填写"}；负责人：${p.owner || "未填写"}；阶段：${snapshot.catalogs?.stages.find((s) => s.id === p.stage)?.zh ?? p.stage}；职责：${p.discipline}`,
        p.aliases.length ? `原别名：${p.aliases.join("、")}` : "",
        p.description ? `项目说明：\n${p.description}` : "",
        p.latestUpdate ? `原汇报：\n${p.latestUpdate}` : "",
        p.reportedAt
          ? `原汇报时间：${p.reportedAt}；报告人：${p.reportedBy ?? "未填写"}`
          : "",
        p.notes ? `原工作笔记：\n${p.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  const latestUpdate =
    all.length === 2 && !incoming[0]!.latestUpdate
      ? target.latestUpdate
      : all
          .filter((p) => p.latestUpdate)
          .map((p) => `${p.name}：${p.latestUpdate}`)
          .join("\n\n");
  if (notes.length > 20000 || latestUpdate.length > 4000 || aliases.length > 15)
    throw new DomainError(
      "Combined project content exceeds the limit. Reduce the selection or shorten the notes and aliases first.",
    );
  const latestReport = [...all].sort((a, b) =>
    (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""),
  )[0]!;
  const project = projectSchema.parse({
    ...target,
    name: input.name,
    shortName: input.shortName ?? target.shortName,
    notes,
    latestUpdate,
    aliases,
    categoryIds: [...new Set(all.flatMap((p) => p.categoryIds ?? []))],
    // Consolidation is not a newly reported delivery fact.
    reportedAt: latestReport.reportedAt,
    reportedBy: latestReport.reportedBy,
    version: target.version + 1,
    updatedAt: now,
  });
  const sourceIds = new Set(input.sourceIds);
  const movedTasks = snapshot.tasks
    .filter((t) => sourceIds.has(t.projectId))
    .map((before) => ({
      before,
      after: {
        ...before,
        projectId: target.id,
        version: before.version + 1,
        updatedAt: now,
      },
    }));
  const nextProjects = snapshot.projects
    .filter((p) => !sourceIds.has(p.id))
    .map((p) => (p.id === target.id ? project : p));
  const changedTasks = new Map(
    movedTasks.map(({ after }) => [after.id, after]),
  );
  validateGraph(
    nextProjects,
    snapshot.tasks.map((t) => changedTasks.get(t.id) ?? t),
  );
  return { target, sources: incoming, project, movedTasks };
}
