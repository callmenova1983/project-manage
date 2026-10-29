import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createWorkspaceDataArchive,
  planWorkspaceDataImport,
  workspaceDataArchive,
  type WorkspaceDataImportReceipt,
} from "../../../packages/domain/workspace-transfer.js";
import type { Actor, Activity } from "../../../packages/domain/types.js";
import type { DailyLogBatch } from "../../../packages/domain/daily-log.js";
import { WORKSPACE_IMPORT_LIMIT } from "../../../packages/domain/progress-material.js";
import { HttpError, type Repository } from "./database.js";
import type { Mutate } from "./intake.js";

function importedId(workspaceId: string, id: string) {
  const hash = createHash("sha256")
    .update(`${workspaceId}:data:${id}`)
    .digest("hex");
  const variant = ((parseInt(hash[16]!, 16) & 3) | 8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function registerWorkspaceTransfer(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  app.get("/api/workspace-data", (req, reply) => {
    const ws = actor(req).workspaceId;
    reply.header(
      "Content-Disposition",
      'attachment; filename="project-data.json"',
    );
    const activities = repo.db
      .prepare(
        "SELECT data FROM activities WHERE workspace_id=? ORDER BY created_at",
      )
      .all(ws)
      .map((row) => JSON.parse(String(row.data)) as Activity);
    const dailyLogs = repo.db
      .prepare(
        "SELECT data FROM daily_logs WHERE workspace_id=? ORDER BY created_at",
      )
      .all(ws)
      .map((row) => JSON.parse(String(row.data)) as DailyLogBatch);
    return createWorkspaceDataArchive(repo.snapshot(ws), activities, dailyLogs);
  });
  app.post(
    "/api/workspace-data",
    { bodyLimit: WORKSPACE_IMPORT_LIMIT },
    (req) =>
      mutate(req, (a) => {
        const request = z
          .object({
            archive: workspaceDataArchive,
            revision: z.number().int().positive(),
            confirmed: z.literal(true),
          })
          .strict()
          .parse(req.body);
        const current = repo.snapshot(a.workspaceId);
        if (current.revision !== request.revision)
          throw new HttpError(
            409,
            "工作区数据已变化，请重新选择文件并确认导入。",
          );
        let plan;
        try {
          plan = planWorkspaceDataImport(
            current,
            request.archive,
            a.role === "admin",
          );
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        repo.db
          .prepare(
            "INSERT INTO workspace_catalogs(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(a.workspaceId, JSON.stringify(plan.catalogs));
        for (const project of plan.projects.changes)
          repo.putProject(
            a.workspaceId,
            project,
            current.projects.find((p) => p.id === project.id),
          );
        for (const task of plan.tasks.changes)
          repo.putTask(
            a.workspaceId,
            task,
            current.tasks.find((t) => t.id === task.id),
            {
              importArchived: !current.projects.some(
                (p) => p.id === task.projectId,
              ),
            },
          );
        repo.db
          .prepare(
            "INSERT INTO workspace_project_order(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(a.workspaceId, JSON.stringify(plan.projectOrder));
        const receipt: WorkspaceDataImportReceipt = {
          projects: plan.projects.counts,
          tasks: plan.tasks.counts,
          activitiesAdded: 0,
          dailyLogsImported: 0,
          unlinkedAssignments: plan.unlinkedAssignments,
        };
        const members = new Set(
          repo.members(a.workspaceId).map((member) => member.id),
        );
        for (const activity of plan.input.activities) {
          const originId = activity.importedFromId ?? activity.id;
          const id = importedId(a.workspaceId, originId);
          if (
            repo.db
              .prepare(
                "SELECT 1 FROM activities WHERE workspace_id=? AND id IN (?,?)",
              )
              .get(a.workspaceId, originId, id)
          )
            continue;
          repo.audit(a.workspaceId, {
            ...activity,
            id,
            importedFromId: originId,
            actorId:
              activity.actorId && members.has(activity.actorId)
                ? activity.actorId
                : undefined,
          });
          receipt.activitiesAdded++;
        }
        for (const batch of plan.input.dailyLogs) {
          const fingerprint = createHash("sha256")
            .update(
              JSON.stringify([batch.source, batch.workDate, batch.reporter]),
            )
            .digest("hex");
          const existing = repo.db
            .prepare(
              "SELECT id,data FROM daily_logs WHERE workspace_id=? AND fingerprint=?",
            )
            .get(a.workspaceId, fingerprint);
          const id = existing
            ? String(existing.id)
            : importedId(a.workspaceId, batch.id);
          const next = { ...batch, id };
          if (
            existing &&
            JSON.stringify(JSON.parse(String(existing.data))) ===
              JSON.stringify(next)
          )
            continue;
          repo.db
            .prepare(
              "INSERT INTO daily_logs(id,workspace_id,fingerprint,created_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            )
            .run(
              id,
              a.workspaceId,
              fingerprint,
              batch.createdAt,
              JSON.stringify(next),
            );
          receipt.dailyLogsImported++;
        }
        repo.record(
          a,
          "import",
          "Imported project data",
          null,
          null,
          `Projects +${receipt.projects.added}, updated ${receipt.projects.updated}; tasks +${receipt.tasks.added}, updated ${receipt.tasks.updated}; history +${receipt.activitiesAdded}; no attachments`,
        );
        return { snapshot: repo.snapshot(a.workspaceId), receipt };
      }),
  );
}
