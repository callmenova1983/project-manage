import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z, ZodError } from "zod";
import {
  DomainError,
  noteDateInput,
  noteDateCandidates,
  projectInput,
  taskInput,
  snapshotImport,
  suggest,
  validateGraph,
  type Project,
  type Task,
  type Actor,
  type Proposal,
  type Suggestion,
} from "../../../packages/domain/types.js";
import { Repository, HttpError } from "./database.js";
import {
  validateAppOrigin,
  allowedMutationOrigin,
  isLoopback,
  type CodespacesOriginRewrite,
} from "./origin.js";
import { safeOriginDiagnostic } from "./origin-diagnostics.js";
import { registerAiRoutes } from "./ai/routes.js";
import { AiError } from "./ai/provider.js";
import type { QwenConfig } from "./ai/config.js";
import {
  hashToken,
  sessionActor,
  verifyPassword,
  passwordHash,
} from "./auth.js";
const versionSchema = z.object({ version: z.number().int().positive() });
const suggestionInput = z
  .object({
    id: z.string(),
    selectedProjectId: z.string().min(1),
    title: z.string().trim().min(1).max(240),
    action: z.enum(["task", "update"]),
    status: z.enum(["todo", "in_progress", "done", "blocked"]),
    confirmed: z.literal(true),
    overwriteConfirmed: z.boolean(),
    projectVersion: z.number().int().positive().optional(),
  })
  .strict();
export async function buildApp(options: {
  databasePath: string;
  origin: string;
  production?: boolean;
  staticPath?: string;
  qwen?: QwenConfig;
  aiFetch?: typeof fetch;
  originDiagnostics?: boolean;
  codespacesOriginRewrite?: CodespacesOriginRewrite;
}) {
  const allowedOrigin = validateAppOrigin(options.origin, !!options.production);
  const repo = new Repository(options.databasePath);
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });
  const dummyHash = await passwordHash(randomBytes(32).toString("hex"));
  await app.register(cookie);
  await app.register(helmet, {
    // The opt-in proxy check needs a browser-protected same-origin Referer.
    // Never send a Referer to other sites; retain Helmet's stricter default
    // for deployments that do not need the Codespaces compatibility branch.
    referrerPolicy: {
      policy: options.codespacesOriginRewrite ? "same-origin" : "no-referrer",
    },
    contentSecurityPolicy: options.production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  const identity = new WeakMap<
    FastifyRequest,
    { actor: Actor; csrf: string }
  >();
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (
      options.originDiagnostics &&
      req.method === "POST" &&
      req.url === "/api/auth/login" &&
      req.headers["x-pm-origin-probe"] === "1"
    ) {
      const peer = req.raw.socket.remoteAddress;
      console.info(
        JSON.stringify(
          safeOriginDiagnostic(req.headers, allowedOrigin, isLoopback(peer)),
        ),
      );
    }
    if (
      mutation &&
      !allowedMutationOrigin(
        req.headers,
        req.raw.socket.remoteAddress,
        allowedOrigin,
        options.codespacesOriginRewrite,
      )
    )
      throw new HttpError(403, "Origin not allowed");
    if (req.url === "/api/health" || req.url === "/api/auth/login") return;
    const session = sessionActor(repo, req.cookies.pm_session);
    identity.set(req, session);
    if (mutation && req.headers["x-csrf-token"] !== session.csrf)
      throw new HttpError(403, "Invalid request token");
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AiError)
      return reply
        .status(err.statusCode)
        .send({ message: err.message, code: err.code });
    if (err instanceof DomainError)
      return reply.status(400).send({ message: err.message });
    if (err instanceof ZodError)
      return reply.status(400).send({
        message: "Please check the submitted values",
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    const e = err as HttpError;
    const code = e.statusCode ?? 500;
    if (code >= 500) req.log.error({ error: e.message }, "Request failed");
    return reply.status(code).send({
      message:
        code >= 500
          ? "The server could not save this change. Please retry."
          : e.message,
      current: e.current,
    });
  });
  app.addHook("onClose", async () => repo.close());
  const actor = (r: FastifyRequest) => identity.get(r)!.actor;
  registerAiRoutes(app, repo, actor, options.qwen, options.aiFetch);
  function mutate<T>(req: FastifyRequest, fn: (a: Actor) => T): T {
    const a = actor(req);
    const key = z.string().uuid().parse(req.headers["idempotency-key"]);
    const hash = createHash("sha256")
      .update(req.method + req.url + JSON.stringify(req.body))
      .digest("hex");
    return repo.transaction(() => {
      const old = repo.db
        .prepare(
          "SELECT request_hash,response FROM idempotency WHERE user_id=? AND key=?",
        )
        .get(a.id, key);
      if (old) {
        if (old.request_hash !== hash)
          throw new HttpError(
            409,
            "This request identifier was already used for another change",
          );
        return JSON.parse(String(old.response)) as T;
      }
      const result = fn(a);
      repo.db
        .prepare(
          "INSERT INTO idempotency(key,user_id,request_hash,response,created_at) VALUES(?,?,?,?,?)",
        )
        .run(key, a.id, hash, JSON.stringify(result), Date.now());
      repo.db
        .prepare("DELETE FROM idempotency WHERE created_at<?")
        .run(Date.now() - 7 * 86400000);
      return result;
    });
  }
  app.get("/api/health", () => ({ status: "ok" }));
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = z
        .object({
          email: z.string().email().max(200),
          password: z.string().min(1).max(500),
        })
        .parse(req.body);
      const user = repo.db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email.toLowerCase());
      const valid = await verifyPassword(
        input.password,
        String(user?.password_hash ?? dummyHash),
      );
      if (!user || !valid)
        throw new HttpError(401, "Email or password is incorrect");
      const token = randomBytes(32).toString("hex"),
        csrf = randomBytes(24).toString("hex");
      repo.transaction(() => {
        // A local reset may have completed while scrypt was verifying the old
        // password. Do not issue a new session for an obsolete credential.
        const current = repo.db
          .prepare("SELECT password_hash FROM users WHERE id=?")
          .get(String(user.id));
        if (!current || current.password_hash !== user.password_hash)
          throw new HttpError(401, "Email or password is incorrect");
        repo.db
          .prepare("DELETE FROM sessions WHERE expires_at<?")
          .run(Date.now());
        repo.db
          .prepare(
            "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
          )
          .run(
            hashToken(token),
            String(user.id),
            csrf,
            Date.now() + 12 * 3600000,
          );
      });
      reply.setCookie("pm_session", token, {
        httpOnly: true,
        secure: !!options.production,
        sameSite: "strict",
        path: "/",
        maxAge: 12 * 3600,
      });
      return {
        actor: {
          id: user.id,
          workspaceId: user.workspace_id,
          name: user.name,
          email: user.email,
        },
        csrf,
      };
    },
  );
  app.get("/api/auth/session", (req) => identity.get(req));
  app.post("/api/auth/logout", async (req, reply) => {
    repo.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(hashToken(req.cookies.pm_session!));
    reply.clearCookie("pm_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/workspace", (req) => repo.snapshot(actor(req).workspaceId));
  app.get("/api/projects", (req) => {
    const q = z
      .object({
        search: z.string().optional(),
        stage: z.string().optional(),
        owner: z.string().optional(),
        discipline: z.string().optional(),
      })
      .parse(req.query);
    return repo
      .snapshot(actor(req).workspaceId)
      .projects.filter(
        (p) =>
          (!q.search ||
            `${p.name} ${p.client} ${p.latestUpdate}`
              .toLowerCase()
              .includes(q.search.toLowerCase())) &&
          (!q.stage || p.stage === q.stage) &&
          (!q.owner || p.owner === q.owner) &&
          (!q.discipline || p.discipline === q.discipline),
      );
  });
  app.get("/api/projects/:id", (req) =>
    repo.get<Project>(
      "projects",
      actor(req).workspaceId,
      (req.params as { id: string }).id,
    ),
  );
  app.get("/api/tasks", (req) => {
    const q = z
      .object({
        projectId: z.string().optional(),
        status: z.string().optional(),
        week: z.string().optional(),
        day: z.string().optional(),
        search: z.string().optional(),
      })
      .parse(req.query);
    return repo
      .snapshot(actor(req).workspaceId)
      .tasks.filter(
        (t) =>
          (!q.projectId || t.projectId === q.projectId) &&
          (!q.status || t.status === q.status) &&
          (!q.week || t.workWeek === q.week) &&
          (!q.day || t.workDates.includes(q.day)) &&
          (!q.search || t.title.toLowerCase().includes(q.search.toLowerCase())),
      );
  });
  app.get(
    "/api/activities",
    (req) => repo.snapshot(actor(req).workspaceId).activities,
  );
  app.post("/api/projects", (req) =>
    mutate(req, (a) => {
      const data = projectInput.parse(req.body);
      const p: Project = {
        ...data,
        reportedAt: data.latestUpdate.trim() ? new Date().toISOString() : null,
        reportedBy: data.latestUpdate.trim() ? a.name : null,
        id: randomUUID(),
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      repo.putProject(a.workspaceId, p);
      repo.record(a, "project", "Created project", null, p);
      return p;
    }),
  );
  app.put("/api/projects/:id", (req) =>
    mutate(req, (a) => {
      const input = projectInput
        .extend({ version: z.number().int().positive() })
        .parse(req.body);
      const old = repo.get<Project>(
        "projects",
        a.workspaceId,
        (req.params as { id: string }).id,
      );
      repo.checkVersion(old, input.version);
      const p = {
        ...input,
        reportedAt:
          input.latestUpdate === old.latestUpdate
            ? (old.reportedAt ?? null)
            : input.latestUpdate.trim()
              ? new Date().toISOString()
              : null,
        reportedBy:
          input.latestUpdate === old.latestUpdate
            ? (old.reportedBy ?? null)
            : input.latestUpdate.trim()
              ? a.name
              : null,
        id: old.id,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      repo.putProject(a.workspaceId, p);
      repo.record(a, "project", "Updated project", old, p);
      return p;
    }),
  );
  app.post("/api/projects/:id/note-dates", (req) =>
    mutate(req, (a) => {
      const input = noteDateInput.parse(req.body);
      const p = repo.get<Project>(
        "projects",
        a.workspaceId,
        (req.params as { id: string }).id,
      );
      repo.checkVersion(p, input.projectVersion);
      const candidate = noteDateCandidates(p.notes).find(
        (n) => n.sourceLine === input.sourceLine,
      );
      if (!candidate)
        throw new HttpError(400, "Date source no longer matches saved notes");
      const old = repo.get<Task>("tasks", a.workspaceId, input.taskId);
      repo.checkVersion(old, input.taskVersion);
      if (old.projectId !== p.id)
        throw new HttpError(400, "Choose a task in this project");
      if (
        old.dueDate &&
        old.dueDate !== input.dueDate &&
        !input.overwriteConfirmed
      )
        throw new HttpError(400, "Confirm replacing the existing due date");
      const next = {
        ...old,
        dueDate: input.dueDate,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      repo.putTask(a.workspaceId, next);
      repo.record(
        a,
        "task",
        "Confirmed date from notes",
        old,
        next,
        `Project notes ${p.id} v${p.version}, line ${candidate.sourceLine}: ${candidate.context}`,
      );
      return next;
    }),
  );
  app.post("/api/tasks", (req) =>
    mutate(req, (a) => {
      const data = taskInput.parse(req.body);
      repo.get("projects", a.workspaceId, data.projectId);
      const t: Task = {
        ...data,
        id: randomUUID(),
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      repo.putTask(a.workspaceId, t);
      repo.validate(a.workspaceId);
      repo.record(a, "task", "Created task", null, t);
      return t;
    }),
  );
  app.post("/api/tasks/batch", (req) =>
    mutate(req, (a) => {
      const input = z
        .object({ tasks: z.array(taskInput).min(1).max(100) })
        .strict()
        .parse(req.body);
      const result = input.tasks.map((data) => {
        repo.get("projects", a.workspaceId, data.projectId);
        const t: Task = {
          ...data,
          id: randomUUID(),
          version: 1,
          updatedAt: new Date().toISOString(),
        };
        repo.putTask(a.workspaceId, t);
        repo.record(
          a,
          "task",
          "Added from pasted text",
          null,
          t,
          "Text / TSV paste",
        );
        return t;
      });
      repo.validate(a.workspaceId);
      return result;
    }),
  );
  app.put("/api/tasks/:id", (req) =>
    mutate(req, (a) => {
      const input = taskInput
        .extend({ version: z.number().int().positive() })
        .parse(req.body);
      const old = repo.get<Task>(
        "tasks",
        a.workspaceId,
        (req.params as { id: string }).id,
      );
      repo.checkVersion(old, input.version);
      if (input.projectId !== old.projectId)
        throw new HttpError(
          400,
          "Moving tasks between projects is not supported",
        );
      const children = repo
        .snapshot(a.workspaceId)
        .tasks.some((t) => t.parentId === old.id);
      if (children && input.status !== old.status)
        throw new HttpError(
          400,
          "Update individual subtasks; parent progress is derived",
        );
      const t = {
        ...input,
        id: old.id,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      repo.putTask(a.workspaceId, t);
      repo.validate(a.workspaceId);
      repo.record(
        a,
        "task",
        old.status !== t.status
          ? `Changed status to ${t.status}`
          : "Updated task",
        old,
        t,
      );
      return t;
    }),
  );
  app.get("/api/export", (req, reply) => {
    reply.header(
      "Content-Disposition",
      'attachment; filename="project-manage-export.json"',
    );
    return repo.snapshot(actor(req).workspaceId);
  });
  app.post("/api/import", (req) =>
    mutate(req, (a) => {
      const input = snapshotImport
        .extend({
          revision: z.number().int().positive(),
          confirmed: z.literal(true),
        })
        .parse(req.body);
      const current = repo.snapshot(a.workspaceId);
      if (current.revision !== input.revision)
        throw new HttpError(
          409,
          "Workspace changed. Export and review the current workspace before replacing it.",
        );
      validateGraph(input.projects, input.tasks);
      repo.db
        .prepare("DELETE FROM tasks WHERE workspace_id=?")
        .run(a.workspaceId);
      repo.db
        .prepare("DELETE FROM projects WHERE workspace_id=?")
        .run(a.workspaceId);
      for (const p of input.projects)
        repo.putProject(a.workspaceId, {
          ...p,
          version:
            Math.max(
              p.version,
              current.projects.find((x) => x.id === p.id)?.version ?? 0,
            ) + 1,
          updatedAt: new Date().toISOString(),
        });
      for (const t of input.tasks)
        repo.putTask(a.workspaceId, {
          ...t,
          version:
            Math.max(
              t.version,
              current.tasks.find((x) => x.id === t.id)?.version ?? 0,
            ) + 1,
          updatedAt: new Date().toISOString(),
        });
      repo.record(
        a,
        "import",
        `Replaced workspace with ${input.projects.length} projects and ${input.tasks.length} tasks`,
        null,
        null,
        "Confirmed JSON import",
      );
      return repo.snapshot(a.workspaceId);
    }),
  );
  app.post("/api/activities/:id/restore", (req) =>
    mutate(req, (a) => {
      const { version } = versionSchema.parse(req.body);
      const row = repo.db
        .prepare("SELECT data FROM activities WHERE workspace_id=? AND id=?")
        .get(a.workspaceId, (req.params as { id: string }).id);
      if (!row) throw new HttpError(404, "History record not found");
      const event = JSON.parse(String(row.data));
      if (!event.before || !["task", "project"].includes(event.kind))
        throw new HttpError(400, "This event cannot be restored");
      const old = repo.get<Project | Task>(
        event.kind === "task" ? "tasks" : "projects",
        a.workspaceId,
        event.entityId,
      );
      repo.checkVersion(old, version);
      const restored = {
        ...event.before,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      if (event.kind === "task") repo.putTask(a.workspaceId, restored);
      else repo.putProject(a.workspaceId, restored);
      repo.validate(a.workspaceId);
      repo.record(
        a,
        event.kind,
        "Restored previous version",
        old,
        restored,
        "History restore",
      );
      return restored;
    }),
  );
  app.post("/api/proposals", (req) =>
    mutate(req, (a) => {
      const { source } = z
        .object({
          source: z
            .string()
            .min(1)
            .max(20000)
            .refine((s) => !!s.trim(), "Enter source text"),
        })
        .strict()
        .parse(req.body);
      const proposal: Proposal = {
        id: randomUUID(),
        source,
        sourceVersion: 1,
        status: "draft",
        createdAt: new Date().toISOString(),
        suggestions: suggest(source, repo.snapshot(a.workspaceId).projects),
      };
      if (proposal.suggestions.length > 100)
        throw new HttpError(400, "Review up to 100 lines at a time");
      repo.db
        .prepare("INSERT INTO proposals(id,workspace_id,data) VALUES(?,?,?)")
        .run(proposal.id, a.workspaceId, JSON.stringify(proposal));
      return proposal;
    }),
  );
  app.post("/api/proposals/:id/apply", (req) =>
    mutate(req, (a) => {
      const { suggestions } = z
        .object({ suggestions: z.array(suggestionInput).min(1).max(100) })
        .strict()
        .parse(req.body);
      const row = repo.db
        .prepare("SELECT data FROM proposals WHERE workspace_id=? AND id=?")
        .get(a.workspaceId, (req.params as { id: string }).id);
      if (!row) throw new HttpError(404, "Suggestion source not found");
      const proposal = JSON.parse(String(row.data)) as Proposal;
      if (proposal.status === "applied")
        throw new HttpError(409, "Suggestions have already been applied");
      if (new Set(suggestions.map((s) => s.id)).size !== suggestions.length)
        throw new HttpError(400, "Duplicate suggestion");
      const saved: Suggestion[] = [];
      const updates = new Map<
        string,
        { before: Project; titles: string[]; sources: string[] }
      >();
      for (const s of suggestions) {
        const original = proposal.suggestions.find((x) => x.id === s.id);
        if (!original)
          throw new HttpError(400, "Suggestion does not match source");
        const p = repo.get<Project>(
          "projects",
          a.workspaceId,
          s.selectedProjectId,
        );
        const source = `Meeting source ${proposal.id} v1, line ${original.sourceLine}: ${original.sourceText}`;
        if (s.action === "update") {
          if (!s.overwriteConfirmed)
            throw new HttpError(
              400,
              "Confirm replacement of the latest project update",
            );
          repo.checkVersion(p, s.projectVersion ?? 0);
          const group = updates.get(p.id) ?? {
            before: p,
            titles: [],
            sources: [],
          };
          group.titles.push(s.title);
          group.sources.push(source);
          updates.set(p.id, group);
        } else {
          const t: Task = {
            id: randomUUID(),
            projectId: p.id,
            parentId: null,
            title: s.title,
            description: original.sourceText,
            status: s.status,
            assignee: "Unassigned",
            dueDate: null,
            workWeek: null,
            workDates: [],
            version: 1,
            updatedAt: new Date().toISOString(),
          };
          repo.putTask(a.workspaceId, t);
          repo.record(a, "task", "Applied reviewed task", null, t, source);
        }
        saved.push({ ...original, ...s });
      }
      for (const group of updates.values()) {
        const next = {
          ...group.before,
          latestUpdate: group.titles.join("\n"),
          version: group.before.version + 1,
          updatedAt: new Date().toISOString(),
          reportedAt: new Date().toISOString(),
          reportedBy: a.name,
        };
        if (next.latestUpdate.length > 4000)
          throw new HttpError(400, "Combined update exceeds 4000 characters");
        repo.putProject(a.workspaceId, next);
        repo.record(
          a,
          "project",
          "Applied reviewed update",
          group.before,
          next,
          group.sources.join("\n"),
        );
      }
      const result = {
        ...proposal,
        status: "applied" as const,
        suggestions: saved,
        appliedAt: new Date().toISOString(),
      };
      repo.db
        .prepare("UPDATE proposals SET data=? WHERE id=? AND workspace_id=?")
        .run(JSON.stringify(result), proposal.id, a.workspaceId);
      return result;
    }),
  );
  const root = options.staticPath ?? resolve("dist/web");
  if (existsSync(root)) {
    await app.register(serveStatic, { root });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.status(404).send({ message: "API route not found" })
        : reply.sendFile("index.html"),
    );
  }
  return { app, repo };
}
