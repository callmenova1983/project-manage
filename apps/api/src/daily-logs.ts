import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import {
  dailyLogInput,
  planDailyLog,
  planBulkProjectFill,
  type DailyLogBatch,
} from "../../../packages/domain/daily-log.js";
import type { Actor } from "../../../packages/domain/types.js";
import { Repository, HttpError } from "./database.js";
import type { Mutate } from "./intake.js";
export function registerDailyLogs(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  app.get("/api/daily-logs", (req) =>
    repo.db
      .prepare(
        "SELECT data FROM daily_logs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 50",
      )
      .all(actor(req).workspaceId)
      .map((row) => JSON.parse(String(row.data)) as DailyLogBatch),
  );
  app.post("/api/daily-logs", (req) =>
    mutate(req, (a) => {
      const input = dailyLogInput.parse(req.body);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([input.source, input.workDate, input.reporter]))
        .digest("hex");
      const row = input.batchId
        ? repo.db
            .prepare(
              "SELECT data FROM daily_logs WHERE workspace_id=? AND id=?",
            )
            .get(a.workspaceId, input.batchId)
        : repo.db
            .prepare(
              "SELECT data FROM daily_logs WHERE workspace_id=? AND fingerprint=?",
            )
            .get(a.workspaceId, fingerprint);
      if (input.batchId && !row) throw new HttpError(404, "日志批次不存在。");
      if (!input.batchId && row)
        return JSON.parse(String(row.data)) as DailyLogBatch;
      let plan;
      try {
        plan = planDailyLog(
          input,
          repo.snapshot(a.workspaceId),
          row ? JSON.parse(String(row.data)) : undefined,
        );
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      for (const project of plan.created) {
        repo.putProject(a.workspaceId, project);
        repo.record(
          a,
          "project",
          "Created project from daily log",
          null,
          project,
          `Daily log ${plan.receipt.id}`,
        );
      }
      for (const change of plan.changes) {
        repo.putProject(a.workspaceId, change.after);
        repo.record(
          a,
          "project",
          "Added daily work log",
          change.before,
          change.after,
          `Daily work log ${plan.receipt.id}, lines ${change.sourceLines.join(",")}`,
          { text: input.source, materialIds: [], workDate: input.workDate },
        );
      }
      repo.db
        .prepare(
          "INSERT INTO daily_logs(id,workspace_id,fingerprint,created_at,data) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(
          plan.receipt.id,
          a.workspaceId,
          fingerprint,
          plan.receipt.createdAt,
          JSON.stringify(plan.receipt),
        );
      return plan.receipt;
    }),
  );
  app.post("/api/projects/bulk-fill", (req) =>
    mutate(req, (a) => {
      let changes;
      try {
        changes = planBulkProjectFill(
          req.body as never,
          repo.snapshot(a.workspaceId),
        );
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      for (const change of changes) {
        repo.putProject(a.workspaceId, change.after);
        repo.record(
          a,
          "project",
          "Filled project details in batch",
          change.before,
          change.after,
        );
      }
      return changes.map((change) => change.after);
    }),
  );
}
