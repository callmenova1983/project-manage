import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  directorySchema,
  type CompanyDirectory,
} from "../../../packages/domain/directory.js";
import type { Actor } from "../../../packages/domain/types.js";
import type { Mutate } from "./intake.js";
import { Repository, HttpError } from "./database.js";
import { adminActor, adminAudit } from "./admin.js";
import { syncWecomDirectory, WecomError, type WecomConfig } from "./wecom.js";

export function registerDirectoryRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
  config?: WecomConfig,
  fetcher?: typeof fetch,
) {
  const configured = (ws: string) => !!config && config.workspaceId === ws;
  const save = (a: Actor, input: CompanyDirectory) => {
    const old = repo.directory(a.workspaceId);
    if (input.version !== old.version)
      throw new HttpError(
        409,
        "Company directory changed. Reload before saving.",
      );
    for (const employee of input.employees) {
      if (
        employee.userId &&
        !repo.db
          .prepare("SELECT 1 FROM users WHERE id=? AND workspace_id=?")
          .get(employee.userId, a.workspaceId)
      )
        throw new HttpError(
          400,
          "Employee account must belong to this workspace.",
        );
    }
    const next = { ...input, version: old.version + 1 };
    repo.db
      .prepare(
        "INSERT INTO workspace_directory(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
      )
      .run(a.workspaceId, JSON.stringify(next));
    adminAudit(repo, a, "Updated company directory", a.workspaceId);
    repo.db
      .prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?")
      .run(a.workspaceId);
    return next;
  };
  app.get("/api/directory", (req) => repo.directory(actor(req).workspaceId));
  app.put("/api/directory", (req) =>
    mutate(req, (a) => {
      adminActor(repo, a);
      const input = directorySchema.parse(req.body);
      return save(a, {
        ...input,
        lastSyncedAt: repo.directory(a.workspaceId).lastSyncedAt,
      });
    }),
  );
  app.get("/api/directory/accounts", (req) =>
    repo.db
      .prepare(
        "SELECT id,name,email,username,status FROM users WHERE workspace_id=? ORDER BY name",
      )
      .all(actor(req).workspaceId),
  );
  app.get("/api/directory/wecom", (req) => ({
    configured: configured(actor(req).workspaceId),
    lastSyncedAt: repo.directory(actor(req).workspaceId).lastSyncedAt,
    mode: "server",
  }));
  app.post("/api/directory/wecom/sync", async (req) => {
    const a = adminActor(repo, actor(req));
    const input = z
      .object({
        version: z.number().int().positive(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    if (!configured(a.workspaceId))
      throw new HttpError(
        503,
        "Enterprise directory sync is not configured for this workspace.",
      );
    const old = repo.directory(a.workspaceId);
    if (old.version !== input.version)
      throw new HttpError(
        409,
        "Company directory changed. Reload before saving.",
      );
    let incoming;
    try {
      incoming = await syncWecomDirectory(old, config!, fetcher);
    } catch (e) {
      throw new WecomError(
        e instanceof WecomError
          ? e.message
          : "Enterprise directory returned invalid data. No local data was changed.",
      );
    }
    return mutate(req, (currentActor) => {
      adminActor(repo, currentActor);
      // The network fetch must not bypass a concurrent local edit.
      return save(currentActor, { ...incoming, version: input.version });
    });
  });
}
