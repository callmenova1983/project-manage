import {
  answerAssistantPlan,
  assistantTurnInput,
  type AssistantTurn,
} from "../../../../packages/domain/assistant-plan.js";
import {
  makeAssistantRequest,
  validateAssistantPlan,
  assistantWorkProposal,
} from "./assistant-plan.js";
import {
  progressAnalysisInput,
  type ProgressAnalysis,
} from "../../../../packages/domain/progress-material.js";
import {
  CAPTURE_SCOPE,
  captureAnalysisInput,
  type CaptureSource,
  type CaptureAnalysis,
  type CaptureRecognitionDepth,
} from "../../../../packages/domain/capture.js";
import {
  localCaptureAnalysis,
  makeCaptureRequest,
  validateCaptureAnalysis,
} from "./capture.js";
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
import { AiError, generateJson } from "./provider.js";
import type { QwenConfig } from "./config.js";
import { allowanceReason } from "./allowance.js";
import { recordModelCallUsage } from "./usage.js";
import { instructionVersions, type AiInstructionId } from "./instructions.js";
import {
  referenceClassifyInput,
  type ReferenceClassification,
} from "../../../../packages/domain/capture-reference.js";
import {
  referenceContext,
  makeReferenceRequest,
  validateReferenceClassification,
  type ReferenceName,
} from "./capture-reference.js";
import { writeModelLog } from "../admin.js";
import type { ModelLog } from "../../../../packages/domain/admin.js";
import { makeTaskReviewRequest, validateTaskReview } from "./task-review.js";
import type { TaskReview } from "../../../../packages/domain/task-review.js";
import {
  projectLocationAnalysisInput,
  type ProjectLocationAnalysis,
  type CityResolution,
} from "../../../../packages/domain/project-location.js";
import {
  makeProjectLocationRequest,
  projectLocationContext,
  validateProjectLocationAnalysis,
} from "./project-location.js";
import {
  mapTranslationInput,
  type MapTranslation,
} from "../../../../packages/domain/map-translation.js";
import {
  makeMapTranslationRequest,
  validateMapTranslation,
} from "./map-translation.js";
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
  const assertAllowance = (config: QwenConfig) => {
    const reason = allowanceReason(config, attempts(config));
    if (reason === "expired")
      throw new AiError(
        429,
        "AI_BUDGET_EXPIRED",
        "The approved AI allowance has expired. Ask an administrator to extend its validity.",
      );
    if (reason === "exhausted")
      throw new AiError(
        429,
        "AI_BUDGET_EXHAUSTED",
        "The approved AI allowance has been used up. Ask an administrator to review the total request limit.",
      );
  };
  app.get("/api/ai/capabilities", (req) => {
    const current = resolveConfig ? resolveConfig(actor(req)) : config;
    const used = attempts(current);
    const reason = allowanceReason(current, used);
    return {
      enabled: reason === null,
      runtime: current ? (current.runtime ?? "legacy") : null,
      provider: current ? "qwen" : null,
      model: current?.model ?? null,
      region: current?.region ?? null,
      connectionVerified: false,
      remainingAttempts: current ? Math.max(0, current.maxRequests - used) : 0,
      availabilityReason: reason,
      expiresAt: current ? new Date(current.expiresAt).toISOString() : null,
    };
  });
  // Old natural-language routes must never silently fall back to rules or spend a model call.
  for (const path of [
    "/api/proposals",
    "/api/proposals/qwen",
    "/api/assistant/query",
    "/api/projects/:id/note-dates",
  ])
    app.post(path, (req) => {
      actor(req);
      throw new AiError(
        410,
        "AI_ENDPOINT_RETIRED",
        "旧版识别接口已停用，请更新页面后使用 AI 助手。输入未处理，也未调用模型。",
      );
    });
  for (const path of [
    "/api/assistant/interpret",
    "/api/tasks/:id/review",
    "/api/projects/:id/progress/analyze",
    "/api/capture/analyze",
    "/api/capture/classify",
    "/api/projects/:id/location/analyze",
    "/api/project-map/translate",
  ])
    app.post(
      path,
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (req) => {
        const config = resolveConfig
          ? resolveConfig(actor(req))
          : configFallback;
        const a = actor(req);
        const interpreting = path === "/api/assistant/interpret";
        const turnInput = interpreting
          ? assistantTurnInput.parse(req.body)
          : undefined;
        const turnPending = turnInput?.pendingProposalId
          ? (() => {
              const row = repo.db
                .prepare(
                  "SELECT data FROM proposals WHERE workspace_id=? AND id=?",
                )
                .get(a.workspaceId, turnInput.pendingProposalId);
              if (!row)
                throw new HttpError(404, "待处理记录不存在，请刷新对话。");
              return JSON.parse(String(row.data)) as Proposal;
            })()
          : undefined;
        if (turnInput?.contextProjectId)
          repo.get<Project>(
            "projects",
            a.workspaceId,
            turnInput.contextProjectId,
          );
        const translating = path === "/api/project-map/translate";
        const translationTexts = translating
          ? mapTranslationInput.parse(req.body).texts
          : [];
        const locating = path === "/api/projects/:id/location/analyze";
        const classifying = path === "/api/capture/classify";
        let referenceFiles: ReferenceName[] = [];
        let project: Project | undefined;
        if (locating) {
          const input = projectLocationAnalysisInput.parse(req.body);
          project = repo.get<Project>(
            "projects",
            a.workspaceId,
            (req.params as { id: string }).id,
          );
          repo.checkVersion(project, input.version);
        }
        let materials: ParsedMaterial[] = [];
        let materialIds: string[] = [];
        let task: Task | undefined;
        let source: string;
        let originalSource: CaptureSource | undefined;
        let recognitionDepth: CaptureRecognitionDepth | undefined;
        const reviewing = path === "/api/tasks/:id/review";
        const capturing = path === "/api/capture/analyze";
        if (interpreting) {
          source = turnInput!.source;
          originalSource = turnInput!.originalSource;
          for (const id of originalSource?.materialIds ?? [])
            readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, id);
        } else if (translating) {
          source = JSON.stringify(translationTexts);
        } else if (classifying) {
          const input = referenceClassifyInput.parse(req.body);
          materialIds = input.materialIds;
          referenceFiles = materialIds.map((id) => {
            const row = repo.db
              .prepare(
                "SELECT metadata FROM progress_materials WHERE id=? AND workspace_id=? AND project_id=?",
              )
              .get(id, a.workspaceId, CAPTURE_SCOPE);
            if (!row) throw new HttpError(404, "Source file not found");
            const metadata = JSON.parse(String(row.metadata)) as {
              name: string;
            };
            return { id, name: metadata.name };
          });
          const projects = repo.snapshot(a.workspaceId).projects;
          source = JSON.stringify(
            referenceContext(referenceFiles, input.notes, projects),
          );
        } else if (locating) {
          source = JSON.stringify(projectLocationContext(project!));
        } else if (capturing) {
          const input = captureAnalysisInput.parse(req.body);
          source = input.text;
          materialIds = input.materialIds;
          recognitionDepth = input.recognitionDepth ?? "text";
          materials = materialIds.map((id) => {
            const m = readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, id);
            return { ...m.metadata, images: m.images };
          });
        } else if (path.endsWith("/analyze")) {
          const input = progressAnalysisInput.parse(req.body);
          project = repo.get<Project>(
            "projects",
            a.workspaceId,
            (req.params as { id: string }).id,
          );
          repo.checkVersion(project, input.version);
          source = input.text;
          materialIds = input.materialIds;
          recognitionDepth = input.recognitionDepth ?? "text";
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
          throw new HttpError(404, "Unknown AI operation");
        }

        const reviewTimeZone =
          task || interpreting
            ? repo.settings(a.workspaceId).timeZone
            : undefined;
        const key = z.string().uuid().parse(req.headers["idempotency-key"]);
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              path,
              turnInput,
              translationWorkspace: translating ? a.workspaceId : undefined,
              source,
              projectId: project?.id,
              projectVersion: project?.version,
              materialIds,
              originalSource,
              recognitionDepth,
              taskId: task?.id,
              version: task?.version,
              timeZone: reviewTimeZone,
            }),
          )
          .digest("hex");
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
        if (translating) {
          const cached = repo.db
            .prepare(
              "SELECT response FROM ai_requests WHERE user_id=? AND request_hash=? AND status='succeeded' LIMIT 1",
            )
            .get(a.id, hash);
          if (cached)
            return JSON.parse(String(cached.response)) as MapTranslation;
        }
        if (capturing && recognitionDepth === "text") {
          const result = localCaptureAnalysis(source, materials);
          repo.db
            .prepare(
              "INSERT INTO ai_requests(user_id,key,request_hash,status,response,created_at) VALUES(?,?,?,'succeeded',?,?)",
            )
            .run(a.id, key, hash, JSON.stringify(result), Date.now());
          return result;
        }
        const validateTemporaryMaterials = () => {
          for (const id of turnInput?.temporaryMaterialIds ?? []) {
            const file = readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, id);
            if (file.metadata.uploadedById !== a.id)
              throw new HttpError(403, "只能清理自己尚未归档的临时附件。");
            if (originalSource?.materialIds.includes(id))
              throw new HttpError(400, "不能同时保留并清理同一附件。");
            if (
              repo.db
                .prepare(
                  "SELECT 1 FROM proposals,json_each(proposals.data,'$.originalSource.materialIds') AS source_file WHERE proposals.workspace_id=? AND source_file.value=? LIMIT 1",
                )
                .get(a.workspaceId, id)
            )
              throw new HttpError(
                409,
                "这个附件已作为原始资料保留，不能按临时图片清理。",
              );
          }
        };
        validateTemporaryMaterials();
        if (!config)
          throw new AiError(
            503,
            "AI_DISABLED",
            "AI 尚未启用，请管理员配置大模型；本次未执行，也不会转为规则识别。",
          );
        const projects = repo.snapshot(a.workspaceId).projects;
        const modelRequest = interpreting
          ? makeAssistantRequest(
              turnInput!,
              projects,
              repo.catalogs(a.workspaceId),
              turnPending,
              config,
              reviewTimeZone,
            )
          : translating
            ? makeMapTranslationRequest(translationTexts, config)
            : classifying
              ? makeReferenceRequest(source, config)
              : locating
                ? makeProjectLocationRequest(project!, config)
                : capturing
                  ? makeCaptureRequest(
                      source,
                      materials,
                      config,
                      recognitionDepth,
                    )
                  : project
                    ? makeProgressRequest(
                        source,
                        project,
                        materials,
                        config,
                        recognitionDepth,
                      )
                    : task
                      ? makeTaskReviewRequest(task, config, reviewTimeZone)
                      : (() => {
                          throw new HttpError(404, "Unknown AI operation");
                        })();
        if (active.has(a.workspaceId))
          throw new AiError(
            409,
            "AI_BUSY",
            "Another AI review is running in this workspace. Wait for it to finish.",
          );
        assertAllowance(config);
        repo.db
          .prepare(
            "INSERT INTO ai_requests(user_id,key,request_hash,status,created_at) VALUES(?,?,?,'started',?)",
          )
          .run(a.id, key, hash, Date.now());
        active.add(a.workspaceId);
        const started = performance.now();
        const instructionId: AiInstructionId = interpreting
          ? "assistant-turn"
          : translating
            ? "map-translation"
            : classifying
              ? "reference-classification"
              : locating
                ? "project-location"
                : capturing
                  ? "capture"
                  : project
                    ? "progress"
                    : task
                      ? "task-review"
                      : "assistant-turn";
        const log: ModelLog = {
          purpose: instructionId,
          instructionVersion: instructionVersions[instructionId],
          runtime: config.runtime ?? "legacy",
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
                assertAllowance(config);
                log.attempts++;
                writeModelLog(repo, a.workspaceId, log);
                repo.db
                  .prepare(
                    "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
                  )
                  .run(randomUUID(), config.budgetId, a.id, Date.now());
              }),
            (value): unknown =>
              interpreting
                ? validateAssistantPlan(
                    value,
                    turnInput!,
                    projects,
                    turnPending,
                  )
                : translating
                  ? validateMapTranslation(value, translationTexts)
                  : classifying
                    ? validateReferenceClassification(
                        value,
                        referenceFiles,
                        projects,
                      )
                    : locating
                      ? validateProjectLocationAnalysis(value, project!)
                      : capturing
                        ? validateCaptureAnalysis(value)
                        : project
                          ? validateProgressAnalysis(value)
                          : task
                            ? validateTaskReview(value, task)
                            : (() => {
                                throw new HttpError(
                                  404,
                                  "Unknown AI operation",
                                );
                              })(),
            fetchImpl,
            (usage) => {
              recordModelCallUsage(log, usage);
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
            (task || interpreting) &&
            repo.settings(a.workspaceId).timeZone !== reviewTimeZone
          )
            throw new AiError(
              409,
              "AI_STALE",
              "The workspace time zone changed during analysis. Refresh before reviewing date suggestions.",
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
          const workProposal =
            interpreting && (result as AssistantTurn["plan"]).kind === "work"
              ? assistantWorkProposal(
                  result as Extract<AssistantTurn["plan"], { kind: "work" }>,
                  turnInput!,
                  config,
                )
              : undefined;
          const proposal:
            | AssistantTurn
            | Proposal
            | TaskReview
            | ProgressAnalysis
            | CaptureAnalysis
            | ProjectLocationAnalysis
            | ReferenceClassification
            | MapTranslation = interpreting
            ? {
                plan: result as AssistantTurn["plan"],
                model: config.model,
                ...((result as AssistantTurn["plan"]).kind === "query"
                  ? {
                      answer: answerAssistantPlan(
                        result as Extract<
                          AssistantTurn["plan"],
                          { kind: "query" }
                        >,
                        repo.snapshot(a.workspaceId),
                        a,
                      ),
                    }
                  : {}),
                ...(workProposal ? { proposal: workProposal } : {}),
              }
            : translating
              ? (result as MapTranslation)
              : classifying
                ? {
                    ...(result as Pick<ReferenceClassification, "files">),
                    provider: "qwen",
                    model: config.model,
                  }
                : locating
                  ? {
                      ...(result as CityResolution),
                      provider: "qwen",
                      model: config.model,
                    }
                  : capturing
                    ? {
                        ...(result as Omit<CaptureAnalysis, "model">),
                        model: config.model,
                      }
                    : project
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
                        : (() => {
                            throw new HttpError(404, "Unknown AI operation");
                          })();
          repo.transaction(() => {
            validateTemporaryMaterials();
            for (const id of turnInput?.temporaryMaterialIds ?? [])
              repo.db
                .prepare(
                  "DELETE FROM progress_materials WHERE id=? AND workspace_id=? AND project_id=?",
                )
                .run(id, a.workspaceId, CAPTURE_SCOPE);

            if (workProposal)
              repo.db
                .prepare(
                  "INSERT INTO proposals(id,workspace_id,data) VALUES(?,?,?)",
                )
                .run(
                  workProposal.id,
                  a.workspaceId,
                  JSON.stringify(workProposal),
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
                diagnostic: e.diagnostic,
              }),
              a.id,
              key,
            );
          log.status = "failed";
          log.errorCode = e.code;
          log.failureDiagnostic = e.diagnostic;
          throw e;
        } finally {
          active.delete(a.workspaceId);
          log.durationMs = Math.round(performance.now() - started);
          writeModelLog(repo, a.workspaceId, log);
        }
      },
    );
}
