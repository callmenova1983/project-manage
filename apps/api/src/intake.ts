import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  intakeInput,
  planIntake,
  verifyIntakeUndo,
  intakeProvenance,
  type IntakeBatch,
} from "../../../packages/domain/intake.js";
import type { Actor } from "../../../packages/domain/types.js";
import { checkProjectCatalog } from "../../../packages/domain/admin.js";
import { Repository, HttpError } from "./database.js";
import { CAPTURE_SCOPE } from "../../../packages/domain/capture.js";
import { readMaterial } from "./progress-materials.js";
export type Mutate = <T>(
  request: FastifyRequest,
  fn: (actor: Actor) => T | Promise<T>,
) => Promise<T>;
export function registerIntakeRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (r: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  app.get("/api/intakes", async (req) =>
    (
      await repo.db
        .prepare(
          "SELECT data FROM intake_batches WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30",
        )
        .all(actor(req).workspaceId)
    ).map((row) => JSON.parse(String(row.data)) as IntakeBatch),
  );
  app.post(
    "/api/intakes",
    async (req) =>
      await mutate(req, async (a) => {
        const input = intakeInput.parse(req.body);
        for (const id of input.source.originalSource?.materialIds ?? [])
          await readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, id);
        const batch = planIntake(
          input,
          await repo.snapshot(a.workspaceId),
          a.name,
          randomUUID,
        );
        for (const project of batch.projects) {
          try {
            checkProjectCatalog(project, await repo.catalogs(a.workspaceId));
          } catch (e) {
            throw new HttpError(400, (e as Error).message);
          }
        }
        for (const p of batch.projects) {
          await repo.putProject(a.workspaceId, p);
          await repo.record(
            a,
            "project",
            "Created project from intake",
            null,
            p,
            intakeProvenance(batch, p.id),
          );
        }
        for (const t of batch.tasks) {
          await repo.putTask(a.workspaceId, t);
          await repo.record(
            a,
            "task",
            "Created task from intake",
            null,
            t,
            intakeProvenance(batch, t.id),
          );
        }
        await repo.validate(a.workspaceId);
        await repo.db
          .prepare(
            "INSERT INTO intake_batches(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
          )
          .run(batch.id, a.workspaceId, batch.createdAt, JSON.stringify(batch));
        return batch;
      }),
  );
  app.post(
    "/api/intakes/:id/undo",
    async (req) =>
      await mutate(req, async (a) => {
        z.object({ confirmed: z.literal(true) })
          .strict()
          .parse(req.body);
        const row = await repo.db
          .prepare(
            "SELECT data FROM intake_batches WHERE workspace_id=? AND id=?",
          )
          .get(a.workspaceId, (req.params as { id: string }).id);
        if (!row) throw new HttpError(404, "Intake not found");
        const batch = JSON.parse(String(row.data)) as IntakeBatch;
        verifyIntakeUndo(batch, await repo.snapshot(a.workspaceId));
        for (const task of batch.tasks)
          await repo.assertProjectWritable(a.workspaceId, task.projectId);
        for (const project of batch.projects)
          await repo.assertProjectWritable(a.workspaceId, project.id);
        for (const task of batch.tasks) {
          await repo.db
            .prepare("DELETE FROM tasks WHERE workspace_id=? AND id=?")
            .run(a.workspaceId, task.id);
          await repo.record(
            a,
            "task",
            "Undid intake",
            task,
            null,
            `Intake undo · ${batch.id}`,
          );
        }
        for (const project of batch.projects) {
          await repo.db
            .prepare("DELETE FROM projects WHERE workspace_id=? AND id=?")
            .run(a.workspaceId, project.id);
          await repo.record(
            a,
            "project",
            "Undid intake",
            project,
            null,
            `Intake undo · ${batch.id}`,
          );
        }
        batch.state = "undone";
        batch.undoneAt = new Date().toISOString();
        await repo.db
          .prepare(
            "UPDATE intake_batches SET data=? WHERE workspace_id=? AND id=?",
          )
          .run(JSON.stringify(batch), a.workspaceId, batch.id);
        return batch;
      }),
  );
}
