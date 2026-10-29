import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/domain/types.js";
import {
  wecomLoginInput,
  safeWecomReturn,
  wecomLoginErrors,
} from "../../../packages/domain/wecom-login.js";
import { Repository, HttpError } from "./database.js";
import { WecomLoginCredentialStore } from "./wecom-login-credentials.js";
import { adminActor, adminAudit } from "./admin.js";
import { hashToken, sessionActor } from "./auth.js";
import { assignLoginName } from "./login-name.js";

export const publicWecomLoginPaths = new Set([
  "/api/auth/wecom/options",
  "/api/auth/wecom/start",
  "/api/auth/wecom/callback",
]);
export function registerWecomLogin(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  options: {
    credentialKeyPath: string;
    origin: string;
    production?: boolean;
    wecomFetch?: typeof fetch;
  },
) {
  const credentials = new WecomLoginCredentialStore(
    repo,
    options.credentialKeyPath,
  );
  const callbackUrl = new URL("/api/auth/wecom/callback", options.origin).href;
  const entryUrl = (ws: string) =>
    new URL(
      `/api/auth/wecom/start?workspace=${encodeURIComponent(ws)}`,
      options.origin,
    ).href;
  const state = async (ws: string) => {
    const saved = await credentials.read(ws);
    const event = await repo.db
      .prepare(
        "SELECT created_at,outcome FROM wecom_login_events WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(ws);
    return {
      version: saved?.version ?? 0,
      enabled: saved?.config.enabled ?? false,
      corpId: saved?.config.corpId ?? "",
      agentId: saved?.config.agentId ?? "",
      autoProvision: saved?.config.autoProvision ?? false,
      secretConfigured: !!saved?.config.secret,
      entryUrl: entryUrl(ws),
      callbackUrl,
      trustedDomain: new URL(options.origin).host,
      lastEvent: event
        ? {
            createdAt: String(event.created_at),
            outcome: String(event.outcome),
          }
        : null,
    };
  };
  app.get(
    "/api/admin/wecom-login",
    async (req) =>
      await state((await adminActor(repo, actor(req))).workspaceId),
  );
  app.put("/api/admin/wecom-login", async (req) => {
    const a = await adminActor(repo, actor(req));
    const input = wecomLoginInput.parse(req.body);
    return await repo.transaction(async () => {
      const previous = await credentials.read(a.workspaceId);
      if (input.version !== (previous?.version ?? 0))
        throw new HttpError(409, "配置已变更，请重新加载后保存。");
      if (
        previous &&
        (input.corpId !== previous.config.corpId ||
          input.agentId !== previous.config.agentId) &&
        !input.secret
      )
        throw new HttpError(400, "更换企业或应用时，请填写对应的新 Secret。");
      const secret = input.secret || previous?.config.secret || "";
      if (!secret) throw new HttpError(400, "请填写应用 Secret。");
      const { version, ...config } = input;
      await credentials.save(a.workspaceId, version + 1, { ...config, secret });
      await adminAudit(
        repo,
        a,
        "Updated WeCom login configuration",
        a.workspaceId,
      );
      return await state(a.workspaceId);
    });
  });
  app.post("/api/admin/wecom-login/check", async (req) => {
    const a = await adminActor(repo, actor(req));
    const saved = await credentials.read(a.workspaceId);
    if (!saved) throw new HttpError(400, "请先保存免登配置。");
    try {
      const token = await get("gettoken", {
        corpid: saved.config.corpId,
        corpsecret: saved.config.secret,
      });
      const accessToken = z.string().min(1).parse(token.access_token);
      const agent = await get("agent/get", {
        access_token: accessToken,
        agentid: saved.config.agentId,
      });
      if (String(agent.agentid) !== saved.config.agentId)
        throw new Error("upstream");
      return {
        message:
          "应用凭据和 AgentID 验证通过。可信域名、应用入口和用户登录仍需从企微客户端验证。",
      };
    } catch {
      throw new HttpError(400, wecomLoginErrors.upstream!);
    }
  });
  app.get("/api/auth/wecom/options", async () => {
    // Do not guess a tenant when more than one workspace enables login.
    const rows = await repo.db
      .prepare("SELECT workspace_id FROM wecom_login_config")
      .all();
    const enabled = [];
    for (const row of rows)
      if ((await credentials.read(String(row.workspace_id)))?.config.enabled)
        enabled.push(row);
    return {
      entryUrl:
        enabled.length === 1
          ? entryUrl(String(enabled[0]!.workspace_id))
          : null,
    };
  });
  const event = async (ws: string, outcome: string) =>
    await repo.db
      .prepare(
        "INSERT INTO wecom_login_events(id,workspace_id,created_at,outcome) VALUES(?,?,?,?)",
      )
      .run(randomUUID(), ws, new Date().toISOString(), outcome);
  const fail = async (
    reply: import("fastify").FastifyReply,
    code: string,
    returnTo = "/projects",
  ) => {
    const url = new URL(safeWecomReturn(returnTo), options.origin);
    url.searchParams.set("wecom_error", code);
    return reply.redirect(url.pathname + url.search + url.hash);
  };
  app.get(
    "/api/auth/wecom/start",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const query = z
        .object({
          workspace: z.string().min(1).max(100),
          returnTo: z.string().optional(),
        })
        .parse(req.query);
      const saved = await credentials.read(query.workspace);
      const returnTo = safeWecomReturn(query.returnTo);
      if (!saved?.config.enabled)
        return await fail(reply, "unavailable", returnTo);
      try {
        const session = await sessionActor(repo, req.cookies.pm_session);
        if (session.actor.workspaceId === query.workspace)
          return reply.redirect(returnTo);
      } catch {
        /* Continue with enterprise authentication. */
      }
      const token = randomBytes(32).toString("hex"),
        browser = randomBytes(32).toString("hex");
      await repo.db
        .prepare("DELETE FROM wecom_login_states WHERE expires_at<=?")
        .run(Date.now());
      await repo.db
        .prepare(
          "INSERT INTO wecom_login_states(state_hash,browser_hash,workspace_id,config_version,return_to,expires_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          hashToken(token),
          hashToken(browser),
          query.workspace,
          saved.version,
          returnTo,
          Date.now() + 5 * 60000,
        );
      reply.setCookie("pm_wecom_flow", browser, {
        httpOnly: true,
        secure: !!options.production,
        sameSite: "lax",
        path: "/api/auth/wecom",
        maxAge: 300,
      });
      const url = new URL(
        "https://open.weixin.qq.com/connect/oauth2/authorize",
      );
      url.search = new URLSearchParams({
        appid: saved.config.corpId,
        agentid: saved.config.agentId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: "snsapi_base",
        state: token,
      }).toString();
      url.hash = "wechat_redirect";
      return reply.redirect(url.href);
    },
  );
  async function get(path: string, params: Record<string, string>) {
    const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`);
    url.search = new URLSearchParams(params).toString();
    const response = await (options.wecomFetch ?? fetch)(url.href, {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("upstream");
    const data = z
      .object({ errcode: z.number().optional() })
      .passthrough()
      .parse(await response.json());
    if (data.errcode && data.errcode !== 0) throw new Error("upstream");
    return data;
  }
  app.get("/api/auth/wecom/callback", async (req, reply) => {
    reply.header("Referrer-Policy", "no-referrer");
    const query = z
      .object({
        state: z.string().regex(/^[a-f0-9]{64}$/),
        code: z.string().min(1).max(512),
      })
      .safeParse(req.query);
    if (!query.success) return await fail(reply, "expired");
    const flow = await repo.transaction(async () => {
      const row = await repo.db
        .prepare(
          "SELECT * FROM wecom_login_states WHERE state_hash=? AND browser_hash=? AND expires_at>?",
        )
        .get(
          hashToken(query.data.state),
          hashToken(req.cookies.pm_wecom_flow ?? ""),
          Date.now(),
        );
      if (row)
        await repo.db
          .prepare("DELETE FROM wecom_login_states WHERE state_hash=?")
          .run(hashToken(query.data.state));
      return row;
    });
    if (!flow) return await fail(reply, "expired");
    reply.clearCookie("pm_wecom_flow", {
      path: "/api/auth/wecom",
      secure: !!options.production,
      sameSite: "lax",
    });
    const ws = String(flow.workspace_id),
      returnTo = String(flow.return_to);
    try {
      const saved = await credentials.read(ws);
      if (!saved?.config.enabled || saved.version !== flow.config_version)
        throw new Error("unavailable");
      const config = saved.config;
      const tokenData = await get("gettoken", {
        corpid: config.corpId,
        corpsecret: config.secret,
      });
      const accessToken = z.string().min(1).parse(tokenData.access_token);
      const identity = await get("auth/getuserinfo", {
        access_token: accessToken,
        code: query.data.code,
      });
      if (typeof identity.UserId !== "string" || !identity.UserId)
        throw new Error("member");
      // Verify active membership with the same application's credential.
      const member = await get("user/get", {
        access_token: accessToken,
        userid: identity.UserId,
      });
      if (member.userid !== identity.UserId || member.status !== 1)
        throw new Error("member");
      const sessionToken = randomBytes(32).toString("hex"),
        csrf = randomBytes(24).toString("hex");
      await repo.transaction(async () => {
        const latest = await credentials.read(ws);
        if (!latest?.config.enabled || latest.version !== saved.version)
          throw new Error("unavailable");
        const directory = await repo.directory(ws);
        const matches = directory.employees.filter(
          (e) =>
            e.wecomCorpId === config.corpId &&
            e.wecomUserId === identity.UserId,
        );
        const employee = matches[0];
        if (matches.length !== 1 || !employee?.active)
          throw new Error("directory");
        if (!employee.userId) {
          if (!config.autoProvision) throw new Error("unlinked");
          // Never silently merge an existing account by name or email.
          if (
            employee.email &&
            (await repo.db
              .prepare("SELECT 1 FROM users WHERE lower(email)=lower(?)")
              .get(employee.email))
          )
            throw new Error("unlinked");
          const id = randomUUID();
          await repo.db
            .prepare(
              "INSERT INTO users(id,workspace_id,email,name,password_hash,username,role,status,requires_activation) VALUES(?,?,?,?,?,?,'member','active',0)",
            )
            .run(
              id,
              ws,
              employee.email || `wecom-${id}@pm.invalid`,
              employee.name,
              "!wecom-only",
              await assignLoginName(repo.db, employee.name),
            );
          employee.userId = id;
          directory.version++;
          await repo.db
            .prepare(
              "UPDATE workspace_directory SET data=? WHERE workspace_id=?",
            )
            .run(JSON.stringify(directory), ws);
          await repo.db
            .prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?")
            .run(ws);
        }
        const user = await repo.db
          .prepare("SELECT * FROM users WHERE id=? AND workspace_id=?")
          .get(employee.userId, ws);
        if (!user || user.status !== "active" || user.requires_activation)
          throw new Error("disabled");
        await repo.db
          .prepare(
            "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
          )
          .run(
            hashToken(sessionToken),
            employee.userId,
            csrf,
            Date.now() + 12 * 3600000,
          );
        await repo.db
          .prepare(
            "INSERT INTO wecom_login_sessions(token_hash,workspace_id,corp_id,wecom_user_id) VALUES(?,?,?,?)",
          )
          .run(
            hashToken(sessionToken),
            ws,
            config.corpId,
            identity.UserId as string,
          );
        await event(ws, "企微免登成功");
      });
      reply.setCookie("pm_session", sessionToken, {
        httpOnly: true,
        secure: !!options.production,
        sameSite: "lax",
        path: "/",
        maxAge: 12 * 3600,
      });
      return reply.redirect(returnTo);
    } catch (error) {
      const code =
        error instanceof Error && wecomLoginErrors[error.message]
          ? error.message
          : "upstream";
      await event(ws, wecomLoginErrors[code]!);
      return await fail(reply, code, returnTo);
    }
  });
}
