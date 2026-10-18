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
export type Mutate = <T>(request: FastifyRequest, fn: (actor: Actor) => T) => T;
export function registerIntakeRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (r: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  app.get("/api/intakes", (req) =>
    repo.db
      .prepare(
        "SELECT data FROM intake_batches WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30",
      )
      .all(actor(req).workspaceId)
      .map((row) => JSON.parse(String(row.data)) as IntakeBatch),
  );
  app.post("/api/intakes", (req) =>
    mutate(req, (a) => {
      const input = intakeInput.parse(req.body);
      for (const id of input.source.originalSource?.materialIds ?? [])
        readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, id);
      const batch = planIntake(
        input,
        repo.snapshot(a.workspaceId),
        a.name,
        randomUUID,
      );
      for (const project of batch.projects) {
        try {
          checkProjectCatalog(project, repo.catalogs(a.workspaceId));
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      for (const p of batch.projects) {
        repo.putProject(a.workspaceId, p);
        repo.record(
          a,
          "project",
          "Created project from intake",
          null,
          p,
          intakeProvenance(batch, p.id),
        );
      }
      for (const t of batch.tasks) {
        repo.putTask(a.workspaceId, t);
        repo.record(
          a,
          "task",
          "Created task from intake",
          null,
          t,
          intakeProvenance(batch, t.id),
        );
      }
      repo.validate(a.workspaceId);
      repo.db
        .prepare(
          "INSERT INTO intake_batches(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
        )
        .run(batch.id, a.workspaceId, batch.createdAt, JSON.stringify(batch));
      return batch;
    }),
  );
  app.post("/api/intakes/:id/undo", (req) =>
    mutate(req, (a) => {
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
      const row = repo.db
        .prepare(
          "SELECT data FROM intake_batches WHERE workspace_id=? AND id=?",
        )
        .get(a.workspaceId, (req.params as { id: string }).id);
      if (!row) throw new HttpError(404, "Intake not found");
      const batch = JSON.parse(String(row.data)) as IntakeBatch;
      verifyIntakeUndo(batch, repo.snapshot(a.workspaceId));
      for (const task of batch.tasks) {
        repo.db
          .prepare("DELETE FROM tasks WHERE workspace_id=? AND id=?")
          .run(a.workspaceId, task.id);
        repo.record(
          a,
          "task",
          "Undid intake",
          task,
          null,
          `Intake undo · ${batch.id}`,
        );
      }
      for (const project of batch.projects) {
        repo.db
          .prepare("DELETE FROM projects WHERE workspace_id=? AND id=?")
          .run(a.workspaceId, project.id);
        repo.record(
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
      repo.db
        .prepare(
          "UPDATE intake_batches SET data=? WHERE workspace_id=? AND id=?",
        )
        .run(JSON.stringify(batch), a.workspaceId, batch.id);
      return batch;
    }),
  );
}
