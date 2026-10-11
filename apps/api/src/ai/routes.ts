import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Actor,
  type Proposal,
} from "../../../../packages/domain/types.js";
import { HttpError, type Repository } from "../database.js";
import { AiError, generateQwen, makeRequest, sourceInput } from "./provider.js";
import type { QwenConfig } from "./config.js";
import { writeModelLog } from "../admin.js";
import type { ModelLog } from "../../../../packages/domain/admin.js";
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
  app.post(
    "/api/proposals/qwen",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      const config = resolveConfig ? resolveConfig(actor(req)) : configFallback;
      if (!config)
        throw new AiError(
          503,
          "AI_DISABLED",
          "Qwen is not enabled on this server. Use rule-assisted review.",
        );
      const a = actor(req);
      const { source } = z
        .object({
          source: sourceInput,
          externalProcessingConfirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      const key = z.string().uuid().parse(req.headers["idempotency-key"]);
      const hash = createHash("sha256").update(source).digest("hex");
      const projects = repo.snapshot(a.workspaceId).projects;
      makeRequest(source, projects, config); // Fail before reserving any paid attempt.
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
        const suggestions = await generateQwen(
          source,
          projects,
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
          fetchImpl,
          (usage) => {
            log.inputTokens = usage.inputTokens;
            log.outputTokens = usage.outputTokens;
          },
        );
        const proposal: Proposal = {
          id: randomUUID(),
          source,
          sourceVersion: 1,
          status: "draft",
          createdAt: new Date().toISOString(),
          suggestions,
          generator: {
            provider: "qwen",
            model: config.model,
            region: config.region,
            promptVersion: 1,
          },
        };
        repo.transaction(() => {
          repo.db
            .prepare(
              "INSERT INTO proposals(id,workspace_id,data) VALUES(?,?,?)",
            )
            .run(proposal.id, a.workspaceId, JSON.stringify(proposal));
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
