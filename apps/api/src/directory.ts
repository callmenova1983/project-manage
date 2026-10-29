import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  directorySchema,
  wecomConfigInput,
  type CompanyDirectory,
} from "../../../packages/domain/directory.js";
import type { Actor } from "../../../packages/domain/types.js";
import type { Mutate } from "./intake.js";
import { Repository, HttpError } from "./database.js";
import { adminActor, adminAudit } from "./admin.js";
import { WecomCredentialStore } from "./wecom-credentials.js";
import { syncWecomDirectory, WecomError, type WecomConfig } from "./wecom.js";

export function registerDirectoryRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
  config?: WecomConfig,
  fetcher?: typeof fetch,
  credentials?: WecomCredentialStore,
) {
  const activeConfig = async (ws: string) =>
    (await credentials?.read(ws))?.config ??
    (config?.workspaceId === ws ? config : undefined);
  const configured = async (ws: string) => !!(await activeConfig(ws));
  const configuration = async (ws: string) => {
    const stored = await credentials?.read(ws);
    const current =
      stored?.config ?? (config?.workspaceId === ws ? config : undefined);
    return {
      version: stored?.version ?? 0,
      corpId: current?.corpId ?? "",
      secretConfigured: !!current?.secret,
      source: stored
        ? ("workspace" as const)
        : current
          ? ("environment" as const)
          : ("none" as const),
    };
  };
  const save = async (a: Actor, input: CompanyDirectory) => {
    const old = await repo.directory(a.workspaceId);
    if (input.version !== old.version)
      throw new HttpError(
        409,
        "Company directory changed. Reload before saving.",
      );
    for (const employee of input.employees) {
      if (
        employee.userId &&
        !(await repo.db
          .prepare("SELECT 1 FROM users WHERE id=? AND workspace_id=?")
          .get(employee.userId, a.workspaceId))
      )
        throw new HttpError(
          400,
          "Employee account must belong to this workspace.",
        );
    }
    const next = { ...input, version: old.version + 1 };
    await repo.db
      .prepare(
        "INSERT INTO workspace_directory(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
      )
      .run(a.workspaceId, JSON.stringify(next));
    await adminAudit(repo, a, "Updated company directory", a.workspaceId);
    await repo.db
      .prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?")
      .run(a.workspaceId);
    return next;
  };
  app.get(
    "/api/directory",
    async (req) => await repo.directory(actor(req).workspaceId),
  );
  app.put(
    "/api/directory",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        const input = directorySchema.parse(req.body);
        return await save(a, {
          ...input,
          lastSyncedAt: (await repo.directory(a.workspaceId)).lastSyncedAt,
        });
      }),
  );
  app.get(
    "/api/directory/accounts",
    async (req) =>
      await repo.db
        .prepare(
          "SELECT id,name,email,username,status FROM users WHERE workspace_id=? ORDER BY name",
        )
        .all(actor(req).workspaceId),
  );
  app.get("/api/directory/wecom", async (req) => ({
    configured: await configured(actor(req).workspaceId),
    lastSyncedAt: (await repo.directory(actor(req).workspaceId)).lastSyncedAt,
    mode: "server",
  }));
  app.get(
    "/api/directory/wecom/config",
    async (req) =>
      await configuration((await adminActor(repo, actor(req))).workspaceId),
  );
  app.put(
    "/api/directory/wecom/config",
    async (req) =>
      await mutate(req, async (a) => {
        await adminActor(repo, a);
        if (!credentials)
          throw new HttpError(503, "当前服务不支持保存企业微信配置。");
        const input = wecomConfigInput.parse(req.body);
        const old = await configuration(a.workspaceId);
        if (old.version !== input.version)
          throw new HttpError(409, "企业微信配置已被修改，请重新打开后保存。");
        const secret =
          input.secret ||
          (old.corpId === input.corpId
            ? (await activeConfig(a.workspaceId))?.secret
            : "");
        if (!secret)
          throw new HttpError(400, "请填写当前企业 ID 对应的 Secret。");
        await credentials.save(
          a.workspaceId,
          { corpId: input.corpId, secret, workspaceId: a.workspaceId },
          old.version + 1,
        );
        await adminAudit(
          repo,
          a,
          "Updated enterprise WeChat configuration",
          a.workspaceId,
        );
        return await configuration(a.workspaceId);
      }),
  );
  app.post("/api/directory/wecom/sync", async (req) => {
    const a = await adminActor(repo, actor(req));
    const input = z
      .object({
        version: z.number().int().positive(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    if (!(await configured(a.workspaceId)))
      throw new HttpError(
        503,
        "Enterprise directory sync is not configured for this workspace.",
      );
    const connectionVersion = (await configuration(a.workspaceId)).version;
    const old = await repo.directory(a.workspaceId);
    if (old.version !== input.version)
      throw new HttpError(
        409,
        "Company directory changed. Reload before saving.",
      );
    let incoming;
    try {
      incoming = await syncWecomDirectory(
        old,
        (await activeConfig(a.workspaceId))!,
        fetcher,
      );
    } catch (e) {
      throw new WecomError(
        e instanceof WecomError
          ? e.message
          : "Enterprise directory returned invalid data. No local data was changed.",
      );
    }
    return await mutate(req, async (currentActor) => {
      await adminActor(repo, currentActor);
      if ((await configuration(a.workspaceId)).version !== connectionVersion)
        throw new HttpError(409, "企业微信配置已变更，请使用新配置重新同步。");
      // The network fetch must not bypass a concurrent local edit.
      const saved = await save(currentActor, {
        ...incoming,
        version: input.version,
      });
      await repo.db
        .prepare(
          "INSERT INTO notification_directory_scope(workspace_id,corp_id,directory_version,synced_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET corp_id=excluded.corp_id,directory_version=excluded.directory_version,synced_at=excluded.synced_at",
        )
        .run(
          a.workspaceId,
          (await activeConfig(a.workspaceId))!.corpId,
          saved.version,
          saved.lastSyncedAt!,
        );
      return saved;
    });
  });
}
