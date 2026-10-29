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
  modelAllowanceInput,
  modelConfigurationInput,
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
import { readModelUsage } from "./ai/usage.js";
async function username(
  repo: Repository,
  name: string,
  requested?: string,
  id?: string,
) {
  try {
    return await assignLoginName(repo.db, name, requested, id);
  } catch (e) {
    if (e instanceof LoginNameConflict) throw new HttpError(409, e.message);
    throw e;
  }
}
const userColumns =
  'id,name,email,username,role,status,version,requires_activation AS "activationRequired"';
export async function adminActor(repo: Repository, a: Actor) {
  if (
    !(await repo.db
      .prepare(
        "SELECT 1 FROM users WHERE id=? AND workspace_id=? AND role='admin' AND status='active'",
      )
      .get(a.id, a.workspaceId))
  )
    throw new HttpError(403, "Administrator access is required");
  return a;
}
export async function readCatalogs(
  repo: Repository,
  ws: string,
): Promise<Catalogs> {
  const row = await repo.db
    .prepare("SELECT data FROM workspace_catalogs WHERE workspace_id=?")
    .get(ws);
  return row
    ? catalogsInput.parse(JSON.parse(String(row.data)))
    : structuredClone(defaultCatalogs);
}
export async function readModelSettings(
  repo: Repository,
  ws: string,
  base?: QwenConfig,
): Promise<ModelSettings> {
  const row = await repo.db
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
export async function workspaceQwen(
  repo: Repository,
  ws: string,
  base?: QwenConfig,
): Promise<QwenConfig | undefined> {
  if (!base) return;
  const s = await readModelSettings(repo, ws, base);
  if (
    !s.enabled ||
    s.secretRef !== "server-default" ||
    s.region !== base.region
  )
    return;
  return {
    ...base,
    model: s.model,
    timeoutMs: Math.min(s.timeoutMs, base.timeoutMs),
    maxTokens: Math.min(s.maxTokens, base.maxTokens),
  };
}
export async function modelAdminState(
  repo: Repository,
  ws: string,
  base?: QwenConfig,
): Promise<ModelAdminState> {
  const settings = await readModelSettings(repo, ws, base),
    attempts = base
      ? Number(
          (await repo.db
            .prepare("SELECT count(*) AS n FROM ai_attempts WHERE budget_id=?")
            .get(base.budgetId))!.n,
        )
      : 0;
  return {
    settings,
    credentialAvailable: !!base,
    runtimeEnabled:
      !!(await workspaceQwen(repo, ws, base)) &&
      base!.expiresAt > Date.now() &&
      attempts < base!.maxRequests,
    approvedRegion: base?.region ?? null,
    approvedModel: base ? settings.model : null,
    remainingAttempts: base ? Math.max(0, base.maxRequests - attempts) : 0,
    maxRequests: base?.maxRequests ?? null,
    usedAttempts: attempts,
    expiresAt: base ? new Date(base.expiresAt).toISOString() : null,
  };
}
export async function adminAudit(
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
  await repo.db
    .prepare(
      "INSERT INTO admin_audit(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
    )
    .run(entry.id, a.workspaceId, entry.createdAt, JSON.stringify(entry));
}
export async function writeModelLog(
  repo: Repository,
  workspaceId: string,
  log: ModelLog,
) {
  await repo.db
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
  const runtime = async (ws: string) => base ?? (await credentials?.read(ws));
  const state = async (ws: string) => ({
    ...(await modelAdminState(repo, ws, await runtime(ws))),
    credentialEditable: !base && !!credentials,
    allowanceEditable: !base && !!(await credentials?.read(ws)),
  });
  const requireAdmin = async (req: FastifyRequest) =>
    await adminActor(repo, actor(req));
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
  const user = async (ws: string, id: string) => {
    const row = await repo.db
      .prepare(`SELECT ${userColumns} FROM users WHERE workspace_id=? AND id=?`)
      .get(ws, id);
    if (!row) throw new HttpError(404, "User not found");
    return serializeUser(row);
  };
  app.get("/api/admin/users", async (req) =>
    (
      await repo.db
        .prepare(
          `SELECT ${userColumns} FROM users WHERE workspace_id=? ORDER BY name`,
        )
        .all((await requireAdmin(req)).workspaceId)
    ).map(serializeUser),
  );
  app.get("/api/admin/account-defaults", async (req) => {
    await requireAdmin(req);
    return {
      starterPasswordConfigured:
        !!starterPassword && starterPassword.length >= 8,
    };
  });
  app.post("/api/admin/users", async (req) => {
    await requireAdmin(req);
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
    return await mutate(req, async (a) => {
      await adminActor(repo, a);
      if (
        await repo.db
          .prepare("SELECT 1 FROM users WHERE email=?")
          .get(input.email)
      )
        throw new HttpError(409, "This email cannot be used for a new account");
      const id = randomUUID();
      await repo.db
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
          await username(repo, input.name, input.username),
        );
      await adminAudit(
        repo,
        a,
        input.useStarterPassword
          ? "Created user with configured initial password"
          : "Created pending user",
        id,
      );
      return await user(a.workspaceId, id);
    });
  });
  app.put(
    "/api/admin/users/:id",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        const input = adminUserUpdate.parse(req.body),
          id = (req.params as { id: string }).id,
          old = await user(a.workspaceId, id);
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
            (await repo.db
              .prepare(
                "SELECT count(*) AS n FROM users WHERE workspace_id=? AND role='admin' AND status='active'",
              )
              .get(a.workspaceId))!.n,
          ) <= 1
        )
          throw new HttpError(409, "Keep at least one active administrator");
        if (
          await repo.db
            .prepare("SELECT 1 FROM users WHERE email=? AND id<>?")
            .get(input.email, id)
        )
          throw new HttpError(409, "This email is already in use");
        await repo.db
          .prepare(
            "UPDATE users SET name=?,email=?,role=?,status=?,username=?,version=version+1 WHERE id=? AND workspace_id=?",
          )
          .run(
            input.name,
            input.email,
            input.role,
            input.status,
            await username(
              repo,
              input.name,
              input.username || old.username,
              id,
            ),
            id,
            a.workspaceId,
          );
        if (
          input.status !== "active" ||
          input.role !== old.role ||
          input.email !== old.email ||
          (input.username && input.username !== old.username)
        )
          await repo.db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        if (input.status === "disabled")
          await repo.db
            .prepare("DELETE FROM user_activations WHERE user_id=?")
            .run(id);
        await adminAudit(repo, a, "Updated user access", id);
        return await user(a.workspaceId, id);
      }),
  );
  // A raw activation token is deliberately never put into the idempotency response cache.
  app.post(
    "/api/admin/users/:id/activation",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const a = await requireAdmin(req),
        id = (req.params as { id: string }).id;
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
      const token = randomBytes(32).toString("hex"),
        expiresAt = Date.now() + 24 * 3600000;
      await repo.transaction(async () => {
        await adminActor(repo, a);
        if ((await user(a.workspaceId, id)).status !== "pending")
          throw new HttpError(
            409,
            "Activation links are only for pending accounts",
          );
        await repo.db
          .prepare("DELETE FROM user_activations WHERE user_id=?")
          .run(id);
        await repo.db
          .prepare(
            "INSERT INTO user_activations(token_hash,user_id,expires_at) VALUES(?,?,?)",
          )
          .run(hashToken(token), id, expiresAt);
        await adminAudit(repo, a, "Issued activation link", id);
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
      await repo.transaction(async () => {
        const row = await repo.db
          .prepare(
            "SELECT users.id,users.workspace_id FROM user_activations JOIN users ON users.id=user_activations.user_id WHERE token_hash=? AND expires_at>? AND used_at IS NULL AND users.status='pending'",
          )
          .get(hashToken(input.token), Date.now());
        if (!row)
          throw new HttpError(400, "Activation link is invalid or expired");
        await repo.db
          .prepare(
            "UPDATE users SET password_hash=?,status='active',requires_activation=0,version=version+1 WHERE id=?",
          )
          .run(hash, String(row.id));
        await repo.db
          .prepare("UPDATE user_activations SET used_at=? WHERE token_hash=?")
          .run(Date.now(), hashToken(input.token));
        await repo.db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(String(row.id));
      });
      return { ok: true };
    },
  );
  app.get(
    "/api/catalogs",
    async (req) => await readCatalogs(repo, actor(req).workspaceId),
  );
  app.put(
    "/api/admin/catalogs",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        const next = catalogsInput.parse(req.body),
          old = await readCatalogs(repo, a.workspaceId);
        if (next.version !== old.version)
          throw new HttpError(409, "Catalog changed. Reload before saving.");
        try {
          checkCatalogs(
            next,
            old,
            (await repo.snapshot(a.workspaceId)).projects,
          );
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        next.version++;
        await repo.db
          .prepare(
            "INSERT INTO workspace_catalogs(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(a.workspaceId, JSON.stringify(next));
        await adminAudit(
          repo,
          a,
          "Updated stage and category catalog",
          a.workspaceId,
        );
        return next;
      }),
  );
  app.get(
    "/api/admin/model",
    async (req) => await state((await requireAdmin(req)).workspaceId),
  );
  app.put(
    "/api/admin/model/configuration",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        const input = modelConfigurationInput.parse(req.body);
        const current = await runtime(a.workspaceId);
        const old = await readModelSettings(repo, a.workspaceId, current);
        const next = input.settings;
        if (next.version !== old.version)
          throw new HttpError(
            409,
            "Model settings changed. Reload before saving.",
          );
        if ((input.credential || input.allowance) && (base || !credentials))
          throw new HttpError(
            403,
            "This allowance is managed by the server operator",
          );
        if (input.credential && !input.allowance && !current)
          throw new HttpError(400, "请填写初始使用限制后保存并启用 AI。");
        if (input.allowance && !input.credential && !current)
          throw new HttpError(400, "请先填写百炼 API Key。");
        const used = current
          ? Number(
              (await repo.db
                .prepare(
                  "SELECT count(*) AS n FROM ai_attempts WHERE budget_id=?",
                )
                .get(current.budgetId))!.n,
            )
          : 0;
        if (input.allowance && input.allowance.maxRequests < used)
          throw new HttpError(400, "总调用上限不能少于已经使用的次数。");
        let config = current;
        if (input.credential) {
          try {
            config = await credentials!.save(a.workspaceId, {
              ...input.credential,
              version: old.version,
              region: next.region,
              maxRequests: input.allowance?.maxRequests ?? current!.maxRequests,
              expiresAt:
                input.allowance?.expiresAt ??
                new Date(current!.expiresAt).toISOString(),
            });
          } catch (e) {
            if (
              e instanceof Error &&
              e.message.startsWith(
                "Invalid or missing server AI configuration:",
              )
            )
              throw new HttpError(400, e.message);
            throw e;
          }
        } else if (input.allowance) {
          config = await credentials!.updateAllowance(a.workspaceId, {
            ...input.allowance,
            version: old.version,
          });
        }
        // Credential selection is automatic; callers never need to choose a secret reference.
        next.secretRef = config ? "server-default" : "";
        if (next.enabled) {
          if (!config) throw new HttpError(400, "请先填写百炼 API Key。");
          if (next.region !== config.region)
            throw new HttpError(
              400,
              "所选区域与已有密钥不匹配，请恢复原区域或更换密钥。",
            );
          if (config.expiresAt <= Date.now())
            throw new HttpError(400, "AI 使用授权已到期，请先调整使用限制。");
          if (used >= config.maxRequests)
            throw new HttpError(400, "AI 调用次数已用完，请先调整使用限制。");
        }
        if (
          config &&
          (next.timeoutMs > config.timeoutMs ||
            next.maxTokens > config.maxTokens)
        )
          throw new HttpError(
            400,
            "Settings exceed the server-approved limits",
          );
        next.version++;
        await repo.db
          .prepare(
            "INSERT INTO model_settings(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(a.workspaceId, JSON.stringify(next));
        await adminAudit(
          repo,
          a,
          next.enabled
            ? "Saved AI configuration and enabled calls"
            : "Saved AI configuration with calls disabled",
          a.workspaceId,
        );
        return await state(a.workspaceId);
      }),
  );
  app.put(
    "/api/admin/model/allowance",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        if (base || !credentials)
          throw new HttpError(
            403,
            "This allowance is managed by the server operator",
          );
        const input = modelAllowanceInput.parse(req.body);
        const current = await runtime(a.workspaceId);
        if (!current)
          throw new HttpError(
            409,
            "Configure the model credential before approving an allowance",
          );
        const old = await readModelSettings(repo, a.workspaceId, current);
        if (input.version !== old.version)
          throw new HttpError(
            409,
            "Model settings changed. Reload before saving.",
          );
        const used = Number(
          (await repo.db
            .prepare("SELECT count(*) AS n FROM ai_attempts WHERE budget_id=?")
            .get(current.budgetId))!.n,
        );
        if (input.maxRequests < used)
          throw new HttpError(400, "总调用上限不能少于已经使用的次数。");
        await credentials.updateAllowance(a.workspaceId, input);
        await repo.db
          .prepare(
            "INSERT INTO model_settings(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(
            a.workspaceId,
            JSON.stringify({ ...old, version: old.version + 1 }),
          );
        await adminAudit(
          repo,
          a,
          "Updated model request allowance",
          `Total ${input.maxRequests}; expires ${input.expiresAt}`,
        );
        return await state(a.workspaceId);
      }),
  );
  app.put(
    "/api/admin/model/credential",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        if (base || !credentials)
          throw new HttpError(
            403,
            "This credential is managed by the server operator",
          );
        const input = modelCredentialInput.parse(req.body);
        const old = await readModelSettings(
          repo,
          a.workspaceId,
          await runtime(a.workspaceId),
        );
        if (input.version !== old.version)
          throw new HttpError(
            409,
            "Model settings changed. Reload before saving.",
          );
        let saved: QwenConfig;
        try {
          saved = await credentials.save(a.workspaceId, input);
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
        await repo.db
          .prepare(
            "INSERT INTO model_settings(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(a.workspaceId, JSON.stringify(next));
        await adminAudit(
          repo,
          a,
          "Saved workspace model credential; calls remain disabled",
          a.workspaceId,
        );
        return await state(a.workspaceId);
      }),
  );
  app.put(
    "/api/admin/model",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        const base = await runtime(a.workspaceId);
        const next = modelSettingsInput.parse(req.body),
          old = await readModelSettings(repo, a.workspaceId, base);
        if (next.version !== old.version)
          throw new HttpError(
            409,
            "Model settings changed. Reload before saving.",
          );
        if (
          next.enabled &&
          (!base ||
            next.secretRef !== "server-default" ||
            next.region !== base.region)
        )
          throw new HttpError(
            400,
            "Provision matching server credentials before enabling calls",
          );
        if (
          base &&
          (next.timeoutMs > base.timeoutMs || next.maxTokens > base.maxTokens)
        )
          throw new HttpError(
            400,
            "Settings exceed the server-approved limits",
          );
        next.version++;
        await repo.db
          .prepare(
            "INSERT INTO model_settings(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
          )
          .run(a.workspaceId, JSON.stringify(next));
        await adminAudit(repo, a, "Updated model settings", a.workspaceId);
        return await state(a.workspaceId);
      }),
  );
  // Aggregate counters only; model logs, actors and provider errors remain admin-only.
  app.get(
    "/api/ai/usage",
    async (req) => await readModelUsage(repo, actor(req).workspaceId),
  );
  app.get("/api/admin/model/logs", async (req) =>
    (
      await repo.db
        .prepare(
          "SELECT data FROM model_logs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all((await requireAdmin(req)).workspaceId)
    ).map((r) => JSON.parse(String(r.data)) as ModelLog),
  );
  app.get("/api/admin/audit", async (req) =>
    (
      await repo.db
        .prepare(
          "SELECT data FROM admin_audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all((await requireAdmin(req)).workspaceId)
    ).map((r) => JSON.parse(String(r.data)) as AdminAudit),
  );
}
