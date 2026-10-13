import { assignLoginName, LoginNameConflict } from "./login-name.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  adminUserInput,
  adminUserUpdate,
  catalogsInput,
  modelSettingsInput,
  modelCredentialInput,
  defaultModelSettings,
  defaultCatalogs,
  checkCatalogs,
  type Catalogs,
  type ManagedUser,
  type ModelSettings,
  type ModelAdminState,
  type ModelLog,
  type AdminAudit,
} from "../../../packages/domain/admin.js";
import type { Actor } from "../../../packages/domain/types.js";
import type { QwenConfig } from "./ai/config.js";
import type { QwenCredentialStore } from "./ai/credentials.js";
import { Repository, HttpError } from "./database.js";
import { hashToken, passwordHash } from "./auth.js";
import type { Mutate } from "./intake.js";
function username(
  repo: Repository,
  name: string,
  requested?: string,
  id?: string,
) {
  try {
    return assignLoginName(repo.db, name, requested, id);
  } catch (e) {
    if (e instanceof LoginNameConflict) throw new HttpError(409, e.message);
    throw e;
  }
}
const userColumns =
  "id,name,email,username,role,status,version,requires_activation AS activationRequired";
export function adminActor(repo: Repository, a: Actor) {
  if (
    !repo.db
      .prepare(
        "SELECT 1 FROM users WHERE id=? AND workspace_id=? AND role='admin' AND status='active'",
      )
      .get(a.id, a.workspaceId)
  )
    throw new HttpError(403, "Administrator access is required");
  return a;
}
export function readCatalogs(repo: Repository, ws: string): Catalogs {
  const row = repo.db
    .prepare("SELECT data FROM workspace_catalogs WHERE workspace_id=?")
    .get(ws);
  return row
    ? catalogsInput.parse(JSON.parse(String(row.data)))
    : structuredClone(defaultCatalogs);
}
export function readModelSettings(
  repo: Repository,
  ws: string,
  base?: QwenConfig,
): ModelSettings {
  const row = repo.db
    .prepare("SELECT data FROM model_settings WHERE workspace_id=?")
    .get(ws);
  return row
    ? modelSettingsInput.parse(JSON.parse(String(row.data)))
    : {
        ...defaultModelSettings,
        ...(base
          ? {
              enabled: true,
              secretRef: "server-default",
              region: base.region,
              timeoutMs: base.timeoutMs,
              maxTokens: base.maxTokens,
            }
          : {}),
      };
}
export function workspaceQwen(
  repo: Repository,
  ws: string,
  base?: QwenConfig,
): QwenConfig | undefined {
  if (!base) return;
  const s = readModelSettings(repo, ws, base);
  if (
    !s.enabled ||
    s.secretRef !== "server-default" ||
    s.region !== base.region ||
    s.model !== base.model
  )
    return;
  return {
    ...base,
    timeoutMs: Math.min(s.timeoutMs, base.timeoutMs),
    maxTokens: Math.min(s.maxTokens, base.maxTokens),
  };
}
export function modelAdminState(
  repo: Repository,
  ws: string,
  base?: QwenConfig,
): ModelAdminState {
  const settings = readModelSettings(repo, ws, base),
    attempts = base
      ? Number(
          repo.db
            .prepare("SELECT count(*) AS n FROM ai_attempts WHERE budget_id=?")
            .get(base.budgetId)!.n,
        )
      : 0;
  return {
    settings,
    credentialAvailable: !!base,
    runtimeEnabled:
      !!workspaceQwen(repo, ws, base) &&
      base!.expiresAt > Date.now() &&
      attempts < base!.maxRequests,
    approvedRegion: base?.region ?? null,
    approvedModel: base?.model ?? null,
    remainingAttempts: base ? Math.max(0, base.maxRequests - attempts) : 0,
    expiresAt: base ? new Date(base.expiresAt).toISOString() : null,
  };
}
export function adminAudit(
  repo: Repository,
  a: Actor,
  action: string,
  target: string,
) {
  const entry: AdminAudit = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    actor: a.name,
    action,
    target,
  };
  repo.db
    .prepare(
      "INSERT INTO admin_audit(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
    )
    .run(entry.id, a.workspaceId, entry.createdAt, JSON.stringify(entry));
}
export function writeModelLog(
  repo: Repository,
  workspaceId: string,
  log: ModelLog,
) {
  repo.db
    .prepare(
      "INSERT INTO model_logs(id,workspace_id,created_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    )
    .run(log.id, workspaceId, log.createdAt, JSON.stringify(log));
}
export function registerAdminRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (r: FastifyRequest) => Actor,
  mutate: Mutate,
  base?: QwenConfig,
  starterPassword?: string,
  credentials?: QwenCredentialStore,
) {
  const runtime = (ws: string) => base ?? credentials?.read(ws);
  const state = (ws: string) => ({
    ...modelAdminState(repo, ws, runtime(ws)),
    credentialEditable: !base && !!credentials,
  });
  const requireAdmin = (req: FastifyRequest) => adminActor(repo, actor(req));
  const serializeUser = (row: Record<string, unknown>): ManagedUser => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    username: String(row.username ?? ""),
    role: row.role as ManagedUser["role"],
    status: row.status as ManagedUser["status"],
    version: Number(row.version),
    activationRequired: !!row.activationRequired,
  });
  const user = (ws: string, id: string) => {
    const row = repo.db
      .prepare(`SELECT ${userColumns} FROM users WHERE workspace_id=? AND id=?`)
      .get(ws, id);
    if (!row) throw new HttpError(404, "User not found");
    return serializeUser(row);
  };
  app.get("/api/admin/users", (req) =>
    repo.db
      .prepare(
        `SELECT ${userColumns} FROM users WHERE workspace_id=? ORDER BY name`,
      )
      .all(requireAdmin(req).workspaceId)
      .map(serializeUser),
  );
  app.get("/api/admin/account-defaults", (req) => {
    requireAdmin(req);
    return {
      starterPasswordConfigured:
        !!starterPassword && starterPassword.length >= 8,
    };
  });
  app.post("/api/admin/users", async (req) => {
    requireAdmin(req);
    const input = adminUserInput.parse(req.body);
    if (
      input.useStarterPassword &&
      (!starterPassword || starterPassword.length < 8)
    )
      throw new HttpError(
        503,
        "The initial password is not configured on the server.",
      );
    const password = await passwordHash(
      input.useStarterPassword
        ? starterPassword!
        : randomBytes(48).toString("hex"),
    );
    return mutate(req, (a) => {
      adminActor(repo, a);
      if (repo.db.prepare("SELECT 1 FROM users WHERE email=?").get(input.email))
        throw new HttpError(409, "This email cannot be used for a new account");
      const id = randomUUID();
      repo.db
        .prepare(
          "INSERT INTO users(id,workspace_id,email,name,password_hash,role,status,requires_activation,username) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          a.workspaceId,
          input.email,
          input.name,
          password,
          input.role,
          input.useStarterPassword ? "active" : "pending",
          input.useStarterPassword ? 0 : 1,
          username(repo, input.name, input.username),
        );
      adminAudit(
        repo,
        a,
        input.useStarterPassword
          ? "Created user with configured initial password"
          : "Created pending user",
        id,
      );
      return user(a.workspaceId, id);
    });
  });
  app.put("/api/admin/users/:id", (req) =>
    mutate(req, (a) => {
      adminActor(repo, a);
      const input = adminUserUpdate.parse(req.body),
        id = (req.params as { id: string }).id,
        old = user(a.workspaceId, id);
      if (input.version !== old.version)
        throw new HttpError(409, "This user changed. Reload before saving.");
      if (old.activationRequired && input.status === "active")
        throw new HttpError(
          400,
          "A pending user must activate their account first",
        );
      if (!old.activationRequired && input.status === "pending")
        throw new HttpError(
          400,
          "Active accounts cannot be returned to pending",
        );
      if (
        old.role === "admin" &&
        old.status === "active" &&
        (input.role !== "admin" || input.status !== "active") &&
        Number(
          repo.db
            .prepare(
              "SELECT count(*) AS n FROM users WHERE workspace_id=? AND role='admin' AND status='active'",
            )
            .get(a.workspaceId)!.n,
        ) <= 1
      )
        throw new HttpError(409, "Keep at least one active administrator");
      if (
        repo.db
          .prepare("SELECT 1 FROM users WHERE email=? AND id<>?")
          .get(input.email, id)
      )
        throw new HttpError(409, "This email is already in use");
      repo.db
        .prepare(
          "UPDATE users SET name=?,email=?,role=?,status=?,username=?,version=version+1 WHERE id=? AND workspace_id=?",
        )
        .run(
          input.name,
          input.email,
          input.role,
          input.status,
          username(repo, input.name, input.username || old.username, id),
          id,
          a.workspaceId,
        );
      if (
        input.status !== "active" ||
        input.role !== old.role ||
        input.email !== old.email ||
        (input.username && input.username !== old.username)
      )
        repo.db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      if (input.status === "disabled")
        repo.db.prepare("DELETE FROM user_activations WHERE user_id=?").run(id);
      adminAudit(repo, a, "Updated user access", id);
      return user(a.workspaceId, id);
    }),
  );
  // A raw activation token is deliberately never put into the idempotency response cache.
  app.post(
    "/api/admin/users/:id/activation",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    (req) => {
      const a = requireAdmin(req),
        id = (req.params as { id: string }).id;
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
      const token = randomBytes(32).toString("hex"),
        expiresAt = Date.now() + 24 * 3600000;
      repo.transaction(() => {
        adminActor(repo, a);
        if (user(a.workspaceId, id).status !== "pending")
          throw new HttpError(
            409,
            "Activation links are only for pending accounts",
          );
        repo.db.prepare("DELETE FROM user_activations WHERE user_id=?").run(id);
        repo.db
          .prepare(
            "INSERT INTO user_activations(token_hash,user_id,expires_at) VALUES(?,?,?)",
          )
          .run(hashToken(token), id, expiresAt);
        adminAudit(repo, a, "Issued activation link", id);
      });
      return {
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        simulated: false,
      };
    },
  );
  app.post(
    "/api/auth/activate",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const input = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string().min(14).max(500),
        })
        .strict()
        .parse(req.body);
      const hash = await passwordHash(input.password);
      repo.transaction(() => {
        const row = repo.db
          .prepare(
            "SELECT users.id,users.workspace_id FROM user_activations JOIN users ON users.id=user_activations.user_id WHERE token_hash=? AND expires_at>? AND used_at IS NULL AND users.status='pending'",
          )
          .get(hashToken(input.token), Date.now());
        if (!row)
          throw new HttpError(400, "Activation link is invalid or expired");
        repo.db
          .prepare(
            "UPDATE users SET password_hash=?,status='active',requires_activation=0,version=version+1 WHERE id=?",
          )
          .run(hash, String(row.id));
        repo.db
          .prepare("UPDATE user_activations SET used_at=? WHERE token_hash=?")
          .run(Date.now(), hashToken(input.token));
        repo.db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(String(row.id));
      });
      return { ok: true };
    },
  );
  app.get("/api/catalogs", (req) => readCatalogs(repo, actor(req).workspaceId));
  app.put("/api/admin/catalogs", (req) =>
    mutate(req, (a) => {
      adminActor(repo, a);
      const next = catalogsInput.parse(req.body),
        old = readCatalogs(repo, a.workspaceId);
      if (next.version !== old.version)
        throw new HttpError(409, "Catalog changed. Reload before saving.");
      try {
        checkCatalogs(next, old, repo.snapshot(a.workspaceId).projects);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      next.version++;
      repo.db
        .prepare(
          "INSERT INTO workspace_catalogs(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
        )
        .run(a.workspaceId, JSON.stringify(next));
      adminAudit(repo, a, "Updated stage and category catalog", a.workspaceId);
      return next;
    }),
  );
  app.get("/api/admin/model", (req) => state(requireAdmin(req).workspaceId));
  app.put("/api/admin/model/credential", (req) =>
    mutate(req, (a) => {
      adminActor(repo, a);
      if (base || !credentials)
        throw new HttpError(
          403,
          "This credential is managed by the server operator",
        );
      const input = modelCredentialInput.parse(req.body);
      const old = readModelSettings(
        repo,
        a.workspaceId,
        runtime(a.workspaceId),
      );
      if (input.version !== old.version)
        throw new HttpError(
          409,
          "Model settings changed. Reload before saving.",
        );
      let saved: QwenConfig;
      try {
        saved = credentials.save(a.workspaceId, input);
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.startsWith("Invalid or missing server AI configuration:")
        )
          throw new HttpError(400, e.message);
        throw e;
      }
      const next: ModelSettings = {
        ...old,
        version: old.version + 1,
        enabled: false,
        region: saved.region,
        secretRef: "server-default",
      };
      repo.db
        .prepare(
          "INSERT INTO model_settings(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
        )
        .run(a.workspaceId, JSON.stringify(next));
      adminAudit(
        repo,
        a,
        "Saved workspace model credential; calls remain disabled",
        a.workspaceId,
      );
      return state(a.workspaceId);
    }),
  );
  app.put("/api/admin/model", (req) =>
    mutate(req, (a) => {
      adminActor(repo, a);
      const base = runtime(a.workspaceId);
      const next = modelSettingsInput.parse(req.body),
        old = readModelSettings(repo, a.workspaceId, base);
      if (next.version !== old.version)
        throw new HttpError(
          409,
          "Model settings changed. Reload before saving.",
        );
      if (
        next.enabled &&
        (!base ||
          next.secretRef !== "server-default" ||
          next.region !== base.region ||
          next.model !== base.model)
      )
        throw new HttpError(
          400,
          "Provision matching server credentials before enabling calls",
        );
      if (
        base &&
        (next.timeoutMs > base.timeoutMs || next.maxTokens > base.maxTokens)
      )
        throw new HttpError(400, "Settings exceed the server-approved limits");
      next.version++;
      repo.db
        .prepare(
          "INSERT INTO model_settings(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
        )
        .run(a.workspaceId, JSON.stringify(next));
      adminAudit(repo, a, "Updated model settings", a.workspaceId);
      return state(a.workspaceId);
    }),
  );
  app.get("/api/admin/model/logs", (req) =>
    repo.db
      .prepare(
        "SELECT data FROM model_logs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(requireAdmin(req).workspaceId)
      .map((r) => JSON.parse(String(r.data)) as ModelLog),
  );
  app.get("/api/admin/audit", (req) =>
    repo.db
      .prepare(
        "SELECT data FROM admin_audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(requireAdmin(req).workspaceId)
      .map((r) => JSON.parse(String(r.data)) as AdminAudit),
  );
}
