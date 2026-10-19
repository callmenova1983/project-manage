import {
  progressAnalysisInput,
  type ProgressAnalysis,
} from "../../../../packages/domain/progress-material.js";
import {
  CAPTURE_SCOPE,
  captureAnalysisInput,
  captureSourceSchema,
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
import {
  AiError,
  generateJson,
  makeRequest,
  sourceInput,
  validateSuggestions,
} from "./provider.js";
import type { QwenConfig } from "./config.js";
import { allowanceReason } from "./allowance.js";
import { recordModelCallUsage } from "./usage.js";
import { instructionVersions, type AiInstructionId } from "./instructions.js";
import { referenceClassifyInput, type ReferenceClassification } from "../../../../packages/domain/capture-reference.js";
import { referenceContext, localReferenceClassification, makeReferenceRequest, validateReferenceClassification, type ReferenceName } from "./capture-reference.js";
import { writeModelLog } from "../admin.js";
import type { ModelLog } from "../../../../packages/domain/admin.js";
import { makeTaskReviewRequest, validateTaskReview } from "./task-review.js";
import type { TaskReview } from "../../../../packages/domain/task-review.js";
import {
  inferProjectLocation,
  projectLocationAnalysisInput,
  type ProjectLocationAnalysis,
  type CityResolution,
} from "../../../../packages/domain/project-location.js";
import { makeProjectLocationRequest, projectLocationContext, validateProjectLocationAnalysis } from "./project-location.js";
import { mapTranslationInput, type MapTranslation } from "../../../../packages/domain/map-translation.js";
import { makeMapTranslationRequest, validateMapTranslation } from "./map-translation.js";
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
        429, "AI_BUDGET_EXPIRED",
        "The approved AI allowance has expired. Ask an administrator to extend its validity.",
      );
    if (reason === "exhausted")
      throw new AiError(
        429, "AI_BUDGET_EXHAUSTED",
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
      provider: current ? "qwen" : "rules",
      model: current?.model ?? null,
      region: current?.region ?? null,
      connectionVerified: false,
      remainingAttempts: current
        ? Math.max(0, current.maxRequests - used)
        : 0,
      availabilityReason: reason,
      expiresAt: current ? new Date(current.expiresAt).toISOString() : null,
    };
  });
  for (const path of [
    "/api/proposals/qwen",
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
        const translating = path === "/api/project-map/translate";
        const translationTexts = translating ? mapTranslationInput.parse(req.body).texts : [];
        const locating = path === "/api/projects/:id/location/analyze";
        const classifying = path === "/api/capture/classify";
        let referenceFiles: ReferenceName[] = [];
        let project: Project | undefined;
        if (locating) {
          const input = projectLocationAnalysisInput.parse(req.body);
          project = repo.get<Project>("projects", a.workspaceId, (req.params as { id: string }).id);
          repo.checkVersion(project, input.version);
          if (!config) return { ...inferProjectLocation(project), provider: "rules", model: null } satisfies ProjectLocationAnalysis;
        }
        let materials: ParsedMaterial[] = [];
        let materialIds: string[] = [];
        let task: Task | undefined;
        let source: string;
        let originalSource: CaptureSource | undefined;
        let recognitionDepth: CaptureRecognitionDepth | undefined;
        const reviewing = path === "/api/tasks/:id/review";
        const capturing = path === "/api/capture/analyze";
        if (translating) {
          source = JSON.stringify(translationTexts);
        } else if (classifying) {
          const input = referenceClassifyInput.parse(req.body);
          materialIds = input.materialIds;
          referenceFiles = materialIds.map(id => {
            const row = repo.db.prepare("SELECT metadata FROM progress_materials WHERE id=? AND workspace_id=? AND project_id=?").get(id, a.workspaceId, CAPTURE_SCOPE);
            if (!row) throw new HttpError(404, "Source file not found");
            const metadata = JSON.parse(String(row.metadata)) as { name: string };
            return { id, name: metadata.name };
          });
          const projects = repo.snapshot(a.workspaceId).projects;
          source = JSON.stringify(referenceContext(referenceFiles, input.notes, projects));
          if (!config || allowanceReason(config, attempts(config)) !== null)
            return localReferenceClassification(referenceFiles, input.notes, projects);
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
          const input = z
            .object({
              source: sourceInput,
              externalProcessingConfirmed: z.literal(true),
              originalSource: captureSourceSchema.optional(),
            })
            .strict()
            .parse(req.body);
          source = input.source;
          originalSource = input.originalSource;
          for (const id of originalSource?.materialIds ?? [])
            readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, id);
        }
        const reviewTimeZone = task
          ? repo.settings(a.workspaceId).timeZone
          : undefined;
        const key = z.string().uuid().parse(req.headers["idempotency-key"]);
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              path,
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
          const cached = repo.db.prepare("SELECT response FROM ai_requests WHERE user_id=? AND request_hash=? AND status='succeeded' LIMIT 1").get(a.id, hash);
          if (cached) return JSON.parse(String(cached.response)) as MapTranslation;
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
        if (!config)
          throw new AiError(
            503,
            "AI_DISABLED",
            "Qwen is not enabled on this server. Use rule-assisted review.",
          );
        const projects = repo.snapshot(a.workspaceId).projects;
        const modelRequest = translating ? makeMapTranslationRequest(translationTexts, config) : classifying ? makeReferenceRequest(source, config) : locating
          ? makeProjectLocationRequest(project!, config)
          : capturing
            ? makeCaptureRequest(source, materials, config, recognitionDepth)
            : project
              ? makeProgressRequest(source, project, materials, config, recognitionDepth)
              : task
                ? makeTaskReviewRequest(task, config, reviewTimeZone)
                : makeRequest(source, projects, config);
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
        const instructionId: AiInstructionId = translating ? "map-translation"
          : classifying ? "reference-classification"
          : locating ? "project-location"
          : capturing ? "capture"
          : project ? "progress"
          : task ? "task-review" : "work-capture";
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
              translating ? validateMapTranslation(value, translationTexts) : classifying ? validateReferenceClassification(value, referenceFiles, projects) : locating
                ? validateProjectLocationAnalysis(value, project!)
                : capturing ? validateCaptureAnalysis(value)
                : project
                  ? validateProgressAnalysis(value)
                  : task
                    ? validateTaskReview(value, task)
                    : validateSuggestions(value, source, projects),
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
          if (task && repo.settings(a.workspaceId).timeZone !== reviewTimeZone)
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
          const proposal:
            Proposal | TaskReview | ProgressAnalysis | CaptureAnalysis | ProjectLocationAnalysis | ReferenceClassification | MapTranslation =
            translating ? result as MapTranslation : classifying ? { ...(result as Pick<ReferenceClassification, "files">), provider: "qwen", model: config.model } : locating
              ? { ...(result as CityResolution), provider: "qwen", model: config.model }
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
                  : {
                      id: randomUUID(),
                      source,
                      ...(originalSource ? { originalSource } : {}),
                      sourceVersion: 1,
                      status: "draft",
                      createdAt: new Date().toISOString(),
                      suggestions: result as Proposal["suggestions"],
                      generator: {
                        provider: "qwen",
                        model: config.model,
                        region: config.region,
                        promptVersion: instructionVersions["work-capture"],
                      },
                    };
          repo.transaction(() => {
            if (!task && !project && !capturing && !classifying && !translating)
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
