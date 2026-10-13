import {
  progressAnalysisInput,
  type ProgressAnalysis,
} from "../../../../packages/domain/progress-material.js";
import { readMaterial, type ParsedMaterial } from "../progress-materials.js";
import { makeProgressRequest, validateProgressAnalysis } from "./progress.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Actor,
  type Proposal,
  type Task,
  type Project,
} from "../../../../packages/domain/types.js";
import { HttpError, type Repository } from "../database.js";
import {
  AiError,
  generateJson,
  makeRequest,
  sourceInput,
  validateSuggestions,
} from "./provider.js";
import type { QwenConfig } from "./config.js";
import { writeModelLog } from "../admin.js";
import type { ModelLog } from "../../../../packages/domain/admin.js";
import { makeTaskReviewRequest, validateTaskReview } from "./task-review.js";
import type { TaskReview } from "../../../../packages/domain/task-review.js";
export function registerAiRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (r: FastifyRequest) => Actor,
  config?: QwenConfig,
  fetchImpl?: typeof fetch,
  resolveConfig?: (actor: Actor) => QwenConfig | undefined,
) {
  const configFallback = config;
  const active = new Set<string>();
  const attempts = (config?: QwenConfig) =>
    config
      ? Number(
          repo.db
            .prepare(
              "SELECT count(*) AS total FROM ai_attempts WHERE budget_id=?",
            )
            .get(config.budgetId)!.total,
        )
      : 0;
  app.get("/api/ai/capabilities", (req) => {
    const current = resolveConfig ? resolveConfig(actor(req)) : config;
    return {
      enabled:
        !!current &&
        current.expiresAt > Date.now() &&
        attempts(current) < current.maxRequests,
      provider: current ? "qwen" : "rules",
      model: current?.model ?? null,
      region: current?.region ?? null,
      connectionVerified: false,
      remainingAttempts: current
        ? Math.max(0, current.maxRequests - attempts(current))
        : 0,
    };
  });
  for (const path of [
    "/api/proposals/qwen",
    "/api/tasks/:id/review",
    "/api/projects/:id/progress/analyze",
  ])
    app.post(
      path,
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (req) => {
        const config = resolveConfig
          ? resolveConfig(actor(req))
          : configFallback;
        if (!config)
          throw new AiError(
            503,
            "AI_DISABLED",
            "Qwen is not enabled on this server. Use rule-assisted review.",
          );
        const a = actor(req);
        let project: Project | undefined;
        let materials: ParsedMaterial[] = [];
        let materialIds: string[] = [];
        let task: Task | undefined;
        let source: string;
        const reviewing = path === "/api/tasks/:id/review";
        if (path.endsWith("/analyze")) {
          const input = progressAnalysisInput.parse(req.body);
          project = repo.get<Project>(
            "projects",
            a.workspaceId,
            (req.params as { id: string }).id,
          );
          repo.checkVersion(project, input.version);
          source = input.text;
          materialIds = input.materialIds;
          materials = materialIds.map((id) => {
            const m = readMaterial(repo, a.workspaceId, project!.id, id);
            return { ...m.metadata, images: m.images };
          });
        } else if (reviewing) {
          const input = z
            .object({ version: z.number().int().positive() })
            .strict()
            .parse(req.body);
          task = repo.get<Task>(
            "tasks",
            a.workspaceId,
            (req.params as { id: string }).id,
          );
          repo.checkVersion(task, input.version);
          source = task.title + "\n" + task.description;
        } else {
          source = z
            .object({
              source: sourceInput,
              externalProcessingConfirmed: z.literal(true),
            })
            .strict()
            .parse(req.body).source;
        }
        const key = z.string().uuid().parse(req.headers["idempotency-key"]);
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              path,
              source,
              projectId: project?.id,
              projectVersion: project?.version,
              materialIds,
              taskId: task?.id,
              version: task?.version,
            }),
          )
          .digest("hex");
        const projects = repo.snapshot(a.workspaceId).projects;
        const modelRequest = project
          ? makeProgressRequest(source, project, materials, config)
          : task
            ? makeTaskReviewRequest(task, config)
            : makeRequest(source, projects, config);
        const old = repo.db
          .prepare(
            "SELECT request_hash,status,response FROM ai_requests WHERE user_id=? AND key=?",
          )
          .get(a.id, key);
        if (old) {
          if (old.request_hash !== hash)
            throw new HttpError(
              409,
              "This AI request identifier belongs to different notes",
            );
          if (old.status === "succeeded")
            return JSON.parse(String(old.response)) as Proposal;
          if (old.status === "failed") {
            const error = JSON.parse(String(old.response)) as {
              statusCode: number;
              code: string;
              message: string;
            };
            throw new AiError(error.statusCode, error.code, error.message);
          }
          throw new AiError(
            409,
            "AI_PENDING",
            "This AI request is pending or was interrupted. No duplicate call was sent. Check the attempt budget before starting a new request.",
          );
        }
        if (active.has(a.workspaceId))
          throw new AiError(
            409,
            "AI_BUSY",
            "Another AI review is running in this workspace. Wait for it to finish.",
          );
        if (
          Date.now() >= config.expiresAt ||
          attempts(config) >= config.maxRequests
        )
          throw new AiError(
            429,
            "AI_BUDGET",
            "The approved AI attempt budget is exhausted or expired.",
          );
        repo.db
          .prepare(
            "INSERT INTO ai_requests(user_id,key,request_hash,status,created_at) VALUES(?,?,?,'started',?)",
          )
          .run(a.id, key, hash, Date.now());
        active.add(a.workspaceId);
        const started = performance.now();
        const log: ModelLog = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          actor: a.name,
          provider: "qwen",
          model: config.model,
          mode: "real",
          status: "started",
          durationMs: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          errorCode: null,
          attempts: 0,
        };
        try {
          writeModelLog(repo, a.workspaceId, log);
          const result = await generateJson(
            modelRequest,
            config,
            () =>
              repo.transaction(() => {
                if (
                  Date.now() >= config.expiresAt ||
                  attempts(config) >= config.maxRequests
                )
                  throw new AiError(
                    429,
                    "AI_BUDGET",
                    "The approved AI attempt budget is exhausted or expired.",
                  );
                log.attempts++;
                writeModelLog(repo, a.workspaceId, log);
                repo.db
                  .prepare(
                    "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
                  )
                  .run(randomUUID(), config.budgetId, a.id, Date.now());
              }),
            (value): unknown =>
              project
                ? validateProgressAnalysis(value)
                : task
                  ? validateTaskReview(value, task)
                  : validateSuggestions(value, source, projects),
            fetchImpl,
            (usage) => {
              log.inputTokens = usage.inputTokens;
              log.outputTokens = usage.outputTokens;
            },
          );
          if (
            task &&
            repo.get<Task>("tasks", a.workspaceId, task.id).version !==
              task.version
          )
            throw new AiError(
              409,
              "AI_STALE",
              "The task changed during analysis. The original and newer edits remain saved.",
            );
          if (
            project &&
            repo.get<Project>("projects", a.workspaceId, project.id).version !==
              project.version
          )
            throw new AiError(
              409,
              "AI_STALE",
              "The project changed during analysis. Your original source is retained; refresh before saving.",
            );
          const proposal: Proposal | TaskReview | ProgressAnalysis = project
            ? {
                ...(result as Omit<ProgressAnalysis, "model">),
                model: config.model,
              }
            : task
              ? {
                  taskId: task.id,
                  version: task.version,
                  ...(result as Pick<TaskReview, "questions">),
                }
              : {
                  id: randomUUID(),
                  source,
                  sourceVersion: 1,
                  status: "draft",
                  createdAt: new Date().toISOString(),
                  suggestions: result as Proposal["suggestions"],
                  generator: {
                    provider: "qwen",
                    model: config.model,
                    region: config.region,
                    promptVersion: 1,
                  },
                };
          repo.transaction(() => {
            if (!task && !project)
              repo.db
                .prepare(
                  "INSERT INTO proposals(id,workspace_id,data) VALUES(?,?,?)",
                )
                .run(
                  (proposal as Proposal).id,
                  a.workspaceId,
                  JSON.stringify(proposal),
                );
            repo.db
              .prepare(
                "UPDATE ai_requests SET status='succeeded',response=? WHERE user_id=? AND key=?",
              )
              .run(JSON.stringify(proposal), a.id, key);
          });
          log.status = "succeeded";
          return proposal;
        } catch (error) {
          const e =
            error instanceof AiError
              ? error
              : new AiError(
                  500,
                  "AI_INTERNAL",
                  "AI review failed. Nothing was applied; check the attempt budget before starting another request.",
                );
          repo.db
            .prepare(
              "UPDATE ai_requests SET status='failed',response=? WHERE user_id=? AND key=?",
            )
            .run(
              JSON.stringify({
                statusCode: e.statusCode,
                code: e.code,
                message: e.message,
              }),
              a.id,
              key,
            );
          log.status = "failed";
          log.errorCode = e.code;
          throw e;
        } finally {
          active.delete(a.workspaceId);
          log.durationMs = Math.round(performance.now() - started);
          writeModelLog(repo, a.workspaceId, log);
        }
      },
    );
}
