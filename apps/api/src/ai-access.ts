import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashToken } from "./auth.js";
import { HttpError, type Repository } from "./database.js";
import { statistics, type Actor } from "../../../packages/domain/types.js";
import type {
  AiAccessState,
  AiAccessGrant,
  PersonalAccessTokenInfo,
} from "../../../packages/domain/ai-access.js";
import { aiAccessDocumentation, type ApiRoute } from "./ai-access-docs.js";

export function personalTokenActor(
  repo: Repository,
  authorization: string,
): Actor {
  const match = /^Bearer (pm_ai_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!match) throw new HttpError(401, "Invalid personal access token");
  const hash = hashToken(match[1]!);
  const row = repo.db
    .prepare(
      `SELECT users.id,users.workspace_id,users.email,users.name,users.role
     FROM personal_access_tokens JOIN users ON users.id=personal_access_tokens.user_id
     WHERE token_hash=? AND users.status='active' AND users.requires_activation=0`,
    )
    .get(hash);
  if (!row)
    throw new HttpError(401, "Personal access token is invalid or revoked");
  repo.db
    .prepare(
      "UPDATE personal_access_tokens SET last_used_at=? WHERE token_hash=?",
    )
    .run(new Date().toISOString(), hash);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as Actor["role"],
  };
}

export function registerAiAccess(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  routes: ApiRoute[],
) {
  const browserActor = (req: FastifyRequest) => {
    if (req.headers.authorization !== undefined)
      throw new HttpError(
        403,
        "Manage personal access tokens from the signed-in browser",
      );
    return actor(req);
  };
  app.get("/api/ai-access/token", (req): AiAccessState => {
    const a = browserActor(req);
    const row = repo.db
      .prepare(
        "SELECT prefix,created_at,last_used_at FROM personal_access_tokens WHERE user_id=?",
      )
      .get(a.id);
    return {
      token: row
        ? {
            prefix: String(row.prefix),
            createdAt: String(row.created_at),
            lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
          }
        : null,
    };
  });
  // Secrets must never enter the shared mutation/idempotency response ledger.
  app.post(
    "/api/ai-access/token",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    (req): AiAccessGrant => {
      const a = browserActor(req);
      z.object({}).strict().parse(req.body);
      const token = `pm_ai_${randomBytes(32).toString("base64url")}`;
      const info: PersonalAccessTokenInfo = {
        prefix: token.slice(0, 14),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      repo.db
        .prepare(
          `INSERT INTO personal_access_tokens(user_id,token_hash,prefix,created_at,last_used_at)
       VALUES(?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET
       token_hash=excluded.token_hash,prefix=excluded.prefix,created_at=excluded.created_at,last_used_at=NULL`,
        )
        .run(a.id, hashToken(token), info.prefix, info.createdAt);
      return { token, info };
    },
  );
  app.delete("/api/ai-access/token", (req) => {
    const a = browserActor(req);
    repo.db
      .prepare("DELETE FROM personal_access_tokens WHERE user_id=?")
      .run(a.id);
    return { token: null } satisfies AiAccessState;
  });
  app.get("/api/ai-access/context", (req) => {
    const a = actor(req);
    const snapshot = repo.snapshot(a.workspaceId);
    return {
      actor: a,
      access: {
        basis: "current_member_permissions",
        workspaceId: a.workspaceId,
        role: a.role,
      },
      revision: snapshot.revision,
      settings: snapshot.settings,
      catalogs: snapshot.catalogs,
      projectCount: snapshot.projects.length,
      projects: snapshot.projects.map((p) => ({
        id: p.id,
        name: p.name,
        shortName: p.shortName,
        client: p.client,
        stage: p.stage,
        owner: p.owner,
        latestUpdate: p.latestUpdate,
        version: p.version,
        updatedAt: p.updatedAt,
        tasks: statistics(
          snapshot.tasks.filter((task) => task.projectId === p.id),
        ),
      })),
      taskOverview: {
        ...statistics(snapshot.tasks),
        recordCount: snapshot.tasks.length,
        voidedCount: snapshot.tasks.filter((task) => task.voided).length,
        countingRule:
          "Status counts include active leaf tasks only; recordCount includes parent and voided tasks.",
      },
      links: {
        docs: "/api/ai-access/docs",
        projects: "/api/projects",
        tasks: "/api/tasks",
        workspace: "/api/workspace",
      },
    };
  });
  app.get("/api/ai-access/docs", () => aiAccessDocumentation(routes));
}
