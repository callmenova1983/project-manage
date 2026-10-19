import {
  referenceContext,
  makeReferenceRequest,
  validateReferenceClassification,
} from "../apps/api/src/ai/capture-reference.js";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  makeCaptureRequest,
  validateCaptureAnalysis,
} from "../apps/api/src/ai/capture.js";
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateQwen, generateJson } from "../apps/api/src/ai/provider.js";
import {
  makeMapTranslationRequest,
  validateMapTranslation,
} from "../apps/api/src/ai/map-translation.js";
import {
  makeTaskReviewRequest,
  validateTaskReview,
} from "../apps/api/src/ai/task-review.js";
import {
  makeProgressRequest,
  validateProgressAnalysis,
} from "../apps/api/src/ai/progress.js";
import {
  makeProjectLocationRequest,
  validateProjectLocationAnalysis,
} from "../apps/api/src/ai/project-location.js";
import type { QwenConfig } from "../apps/api/src/ai/config.js";
import { modelSettingsInput, type ModelLog } from "../packages/domain/admin.js";
import { recordModelCallUsage } from "../apps/api/src/ai/usage.js";
import { allowanceReason } from "../apps/api/src/ai/allowance.js";
import { createSeed } from "../packages/domain/seed.js";
import { dailyReportEvaluation } from "../tests/fixtures/daily-report-evaluation.js";
import { dailyReportHoldout } from "../tests/fixtures/daily-report-holdout.js";
import { dailyReportHoldoutV2 } from "../tests/fixtures/daily-report-holdout-v2.js";
import { compareAssistantRuns } from "./assistant-comparison.js";
import { instructionVersions } from "../apps/api/src/ai/instructions.js";

// Operator-only local acceptance runner. Synthetic input; no business writes.
// Default is read-only inspection. --run permits two metered model requests.
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  args.some(
    (arg) =>
      ![
        "--run",
        "--benchmark",
        "--holdout",
        "--holdout-v2",
        "--recheck",
        "--toolcheck",
        "--meetingcheck",
        "--translationcheck",
        "--reviewcheck",
        "--progresscheck",
        "--locationcheck",
        "--imagecheck",
        "--referencecheck",
      ].includes(arg),
  )
)
  throw new Error(
    "Use --run, --benchmark or --holdout, or no arguments for inspection",
  );
const benchmark = args.includes("--benchmark");
const toolcheck = args.includes("--toolcheck");
const meetingcheck = args.includes("--meetingcheck");
const translationcheck = args.includes("--translationcheck");
const reviewcheck = args.includes("--reviewcheck");
const progresscheck = args.includes("--progresscheck");
const locationcheck = args.includes("--locationcheck");
const imagecheck = args.includes("--imagecheck");
const referencecheck = args.includes("--referencecheck");
const pagecheck =
  translationcheck ||
  reviewcheck ||
  progresscheck ||
  locationcheck ||
  imagecheck ||
  referencecheck;
const recheck = args.includes("--recheck");
const holdoutV2 = args.includes("--holdout-v2");
const holdout = args.includes("--holdout") || holdoutV2 || recheck;
const acceptanceCases = holdoutV2
  ? dailyReportHoldoutV2
  : recheck
    ? dailyReportHoldout.filter((sample) =>
        ["holdout-13", "holdout-17", "holdout-19"].includes(sample.id),
      )
    : dailyReportHoldout;
const live =
  benchmark ||
  holdout ||
  toolcheck ||
  meetingcheck ||
  pagecheck ||
  args.includes("--run");
const databasePath = resolve("data/project-manage.sqlite");
const db = new DatabaseSync(databasePath, { readOnly: !live });
try {
  const rows = db
    .prepare(
      "SELECT workspace_id,encrypted_config FROM workspace_ai_credentials",
    )
    .all();
  if (rows.length !== 1)
    throw new Error("Select one workspace before running verification");
  const ws = String(rows[0]!.workspace_id);
  const [iv, tag, encrypted] = String(rows[0]!.encrypted_config).split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    readFileSync(databasePath + ".credentials-key"),
    Buffer.from(iv!, "base64"),
  );
  decipher.setAAD(Buffer.from(ws));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  const base = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted!, "base64")),
      decipher.final(),
    ]).toString(),
  ) as QwenConfig;
  const settings = () =>
    modelSettingsInput.parse(
      JSON.parse(
        String(
          db
            .prepare("SELECT data FROM model_settings WHERE workspace_id=?")
            .get(ws)?.data,
        ),
      ),
    );
  const state = settings();
  const used = () =>
    Number(
      db
        .prepare("SELECT count(*) AS n FROM ai_attempts WHERE budget_id=?")
        .get(base.budgetId)!.n,
    );
  const config: QwenConfig = {
    ...base,
    model: state.model,
    timeoutMs: Math.min(base.timeoutMs, state.timeoutMs),
    maxTokens: Math.min(base.maxTokens, state.maxTokens),
    retries: 0,
  };
  const enabled =
    state.enabled &&
    state.secretRef === "server-default" &&
    state.region === base.region;
  console.log(
    JSON.stringify({
      enabled,
      model: config.model,
      endpointHost: new URL(config.baseUrl).hostname,
      timeoutMs: config.timeoutMs,
      remainingAttempts: Math.max(0, base.maxRequests - used()),
      allowance: allowanceReason(config, used()),
      live,
    }),
  );
  if (live) {
    if (
      !enabled ||
      allowanceReason(config, used()) ||
      base.maxRequests - used() <
        (meetingcheck || pagecheck
          ? 1
          : holdout
            ? acceptanceCases.length
            : benchmark
              ? dailyReportEvaluation.length * 2
              : 2)
    )
      throw new Error("Insufficient enabled allowance");
    const actor = db
      .prepare(
        "SELECT id FROM users WHERE workspace_id=? AND role='admin' AND status='active' ORDER BY id LIMIT 1",
      )
      .get(ws);
    if (!actor)
      throw new Error(
        "No workspace administrator available for operational accounting",
      );
    if (pagecheck) {
      const texts = ["示例学校：设备已上线", "接口等待客户确认，下周安排培训"];
      const project = {
        ...createSeed().projects[0]!,
        name: "杭州西湖区示例学校",
        shortName: "示例学校",
        description: "位于杭州市西湖区",
        client: "示例客户",
        aliases: [],
      };
      const task = {
        ...createSeed().tasks[0]!,
        title: "安排设备培训",
        description: "李明负责，必须在2026年10月23日前完成。",
        assignee: "",
        dueDate: "",
      };
      const notes =
        "设备已经上线。接口仍等待客户确认。下周安排培训，具体日期尚未确定。";
      const imageLines = [
        "示例学校日报",
        "李明：设备已上线。",
        "接口等待客户确认。",
        "下周安排培训，日期未定。",
      ];
      const imageMaterial = () => {
        GlobalFonts.registerFromPath(
          "/System/Library/Fonts/STHeiti Medium.ttc",
          "AcceptanceCJK",
        );
        const canvas = createCanvas(1000, 340);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 1000, 340);
        ctx.fillStyle = "black";
        ctx.font = "32px AcceptanceCJK";
        imageLines.forEach((line, i) => ctx.fillText(line, 30, 65 + i * 70));
        const png = canvas.toBuffer("image/png");
        mkdirSync(resolve("artifacts/assistant-live"), { recursive: true });
        writeFileSync(
          resolve("artifacts/assistant-live/synthetic-capture-cjk.png"),
          png,
        );
        return {
          text: "",
          images: [`data:image/png;base64,${png.toString("base64")}`],
          kind: "image" as const,
          warnings: [],
        };
      };
      const files = [
        { id: "synthetic-quote", name: "示例学校设备报价.xlsx" },
        { id: "synthetic-photo", name: "现场照片.jpg" },
      ];
      const referenceSource = referenceContext(files, "", [project]);
      const purpose = referencecheck
        ? "reference-classification"
        : imagecheck
          ? "capture"
          : reviewcheck
            ? "task-review"
            : progresscheck
              ? "progress"
              : locationcheck
                ? "project-location"
                : "map-translation";
      const request = referencecheck
        ? makeReferenceRequest(JSON.stringify(referenceSource), config)
        : imagecheck
          ? makeCaptureRequest("", [imageMaterial()], config, "ocr")
          : reviewcheck
            ? makeTaskReviewRequest(
                task,
                config,
                "Asia/Shanghai",
                new Date("2026-10-19T00:00:00Z"),
              )
            : progresscheck
              ? makeProgressRequest(notes, project, [], config)
              : locationcheck
                ? makeProjectLocationRequest(project, config)
                : makeMapTranslationRequest(texts, config);
      const validate = (value: unknown): unknown =>
        referencecheck
          ? validateReferenceClassification(value, files, [project])
          : imagecheck
            ? validateCaptureAnalysis(value)
            : reviewcheck
              ? validateTaskReview(value, task)
              : progresscheck
                ? validateProgressAnalysis(value)
                : locationcheck
                  ? validateProjectLocationAnalysis(value, project)
                  : validateMapTranslation(value, texts);
      const log: ModelLog = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        actor: "Synthetic acceptance",
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
        runtime: "sdk",
        purpose,
        instructionVersion: instructionVersions[purpose],
      };
      const save = () =>
        db
          .prepare(
            "INSERT INTO model_logs(id,workspace_id,created_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(log.id, ws, log.createdAt, JSON.stringify(log));
      const started = performance.now();
      let output: unknown;
      save();
      try {
        output = await generateJson(
          request,
          { ...config, runtime: "sdk" },
          () => {
            db.exec("BEGIN IMMEDIATE");
            try {
              const current = settings();
              if (
                !current.enabled ||
                current.model !== config.model ||
                allowanceReason(config, used())
              )
                throw Error("Allowance changed");
              db.prepare(
                "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
              ).run(
                randomUUID(),
                config.budgetId,
                String(actor.id),
                Date.now(),
              );
              log.attempts++;
              save();
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          },
          validate,
          fetch,
          (usage) => recordModelCallUsage(log, usage),
        );
        log.status = "succeeded";
      } catch (error) {
        log.status = "failed";
        log.errorCode =
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : "VERIFICATION_FAILED";
        process.exitCode = 1;
      } finally {
        log.durationMs = Math.round(performance.now() - started);
        save();
        const dir = resolve("artifacts/assistant-live");
        mkdirSync(dir, { recursive: true });
        const path = resolve(dir, `${purpose}-check-${Date.now()}.json`);
        writeFileSync(
          path,
          JSON.stringify(
            {
              input: referencecheck
                ? referenceSource
                : imagecheck
                  ? { imageLines, image: "synthetic-capture-cjk.png" }
                  : reviewcheck
                    ? task
                    : progresscheck
                      ? { notes, project }
                      : locationcheck
                        ? project
                        : texts,
              output,
              log,
            },
            null,
            2,
          ),
          {
            flag: "wx",
          },
        );
        console.log(
          JSON.stringify({
            status: log.status,
            attempts: log.attempts,
            durationMs: log.durationMs,
            evidence: path,
          }),
        );
      }
    } else {
      const project = {
        ...createSeed().projects[0]!,
        name: "青禾示例学校",
        shortName: "青禾学校",
        aliases: ["青禾学校", "示例项目", "示例学校"],
      };
      const source =
        "李明\nReport to:王经理\n今日工作总结\n1. 青禾学校设备排查已完成\n2. 青禾学校约好周五到场联调";
      const projects = toolcheck
        ? [
            project,
            ...Array.from({ length: 25 }, (_, i) => ({
              ...project,
              id: `synthetic-project-${i}`,
              name: `其他合成项目${i}`,
              shortName: `合成${i}`,
              aliases: [],
            })),
          ]
        : [project];
      const cases = meetingcheck
        ? [
            {
              id: "structured-meeting-current",
              source:
                "## 项目会议纪要\n### 青禾学校项目\n- 设备上线已完成。\n- 接口资料已发送，但客户尚未回复，当前接口联调受阻。\n- 下周安排现场培训。\n### 其他项目\n- 另一个学校项目计划参考青禾学校准备申报。",
              items: [
                {
                  action: "update",
                  status: "done",
                  contains: "设备",
                  assignee: undefined,
                },
                {
                  action: "update",
                  status: "blocked",
                  contains: "接口",
                  assignee: undefined,
                },
                {
                  action: "task",
                  status: "todo",
                  contains: "培训",
                  assignee: undefined,
                },
                {
                  action: "task",
                  status: "todo",
                  contains: "申报",
                  assignee: undefined,
                },
              ],
              workDate: undefined,
              invalidWorkDate: undefined,
            },
          ]
        : holdout
          ? acceptanceCases
          : benchmark
            ? dailyReportEvaluation
            : [
                {
                  id: "smoke",
                  source,
                  items: [
                    {
                      action: "update",
                      status: "done",
                      contains: "设备排查已完成",
                      assignee: "李明",
                    },
                    {
                      action: "task",
                      status: "todo",
                      contains: "周五到场联调",
                      assignee: "李明",
                    },
                  ],
                  workDate: undefined,
                  invalidWorkDate: undefined,
                },
              ];
      const corpusHash = createHash("sha256")
        .update(JSON.stringify(cases))
        .digest("hex");
      const results: unknown[] = [];
      const samples: Record<
        string,
        {
          id: string;
          durationMs: number;
          inputTokens: number | null;
          outputTokens: number | null;
          passed: boolean;
          criticalErrors: number;
        }[]
      > = { legacy: [], sdk: [] };
      const dir = resolve("artifacts/assistant-live");
      mkdirSync(dir, { recursive: true });
      const path = resolve(
        dir,
        `${meetingcheck ? "meetingcheck" : toolcheck ? "toolcheck" : recheck ? "recheck" : holdoutV2 ? "holdout-v2" : holdout ? "holdout" : benchmark ? "benchmark" : "smoke"}-${Date.now()}.json`,
      );
      writeFileSync(path, JSON.stringify({ corpusHash, results }), {
        flag: "wx",
      });
      for (const [index, example] of cases.entries()) {
        for (const runtime of (holdout || toolcheck || meetingcheck
          ? ["sdk"]
          : index % 2
            ? ["sdk", "legacy"]
            : ["legacy", "sdk"]) as ("sdk" | "legacy")[]) {
          let passed = false,
            criticalErrors = 0;
          const toolCalls: unknown[] = [];
          const toolResponses: unknown[] = [];
          const observedFetch: typeof fetch = async (input, init) => {
            const response = await fetch(input, init);
            if (toolcheck && response.ok) {
              const envelope = await response.clone().json();
              toolResponses.push(envelope);
              toolCalls.push(
                ...(envelope.choices?.[0]?.message?.tool_calls ?? []),
              );
            }
            return response;
          };
          const log: ModelLog = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            actor: "Local AI upgrade verification",
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
            runtime,
            purpose: "work-capture",
            instructionVersion: instructionVersions["work-capture"],
          };
          const saveLog = () =>
            db
              .prepare(
                "INSERT INTO model_logs(id,workspace_id,created_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
              )
              .run(log.id, ws, log.createdAt, JSON.stringify(log));
          const start = performance.now();
          saveLog();
          try {
            const output = await generateQwen(
              example.source,
              projects,
              { ...config, runtime },
              () => {
                db.exec("BEGIN IMMEDIATE");
                try {
                  const current = settings();
                  if (
                    !current.enabled ||
                    current.model !== config.model ||
                    allowanceReason(config, used())
                  )
                    throw new Error("Allowance changed");
                  db.prepare(
                    "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
                  ).run(
                    randomUUID(),
                    config.budgetId,
                    String(actor.id),
                    Date.now(),
                  );
                  log.attempts++;
                  saveLog();
                  db.exec("COMMIT");
                } catch (error) {
                  db.exec("ROLLBACK");
                  throw error;
                }
              },
              observedFetch,
              (usage) => recordModelCallUsage(log, usage),
            );
            log.status = "succeeded";
            passed =
              (!meetingcheck ||
                (output
                  .slice(0, 3)
                  .every(
                    (item) =>
                      item.candidates.length === 1 &&
                      item.candidates[0]?.projectId === project.id,
                  ) &&
                  output[3]?.candidates.length === 0)) &&
              (!toolcheck ||
                (log.attempts === 2 &&
                  toolCalls.length === 1 &&
                  output.every((item) =>
                    item.candidates.some(
                      (candidate) => candidate.projectId === project.id,
                    ),
                  ))) &&
              output.length === example.items.length &&
              example.items.every((expected, i) => {
                const actual = output[i]!;
                return (
                  actual &&
                  actual.action === expected.action &&
                  actual.status === expected.status &&
                  actual.title.includes(expected.contains) &&
                  actual.assignee === expected.assignee &&
                  actual.workDate === example.workDate &&
                  actual.invalidWorkDate === example.invalidWorkDate
                );
              });
            criticalErrors = output.reduce(
              (count, actual, i) =>
                count +
                Number(
                  actual.assignee !== example.items[i]?.assignee ||
                    actual.action !== example.items[i]?.action ||
                    (actual.status === "done" &&
                      example.items[i]?.status !== "done") ||
                    actual.workDate !== example.workDate ||
                    actual.invalidWorkDate !== example.invalidWorkDate ||
                    "dueDate" in actual ||
                    actual.sourceText !==
                      example.source.split("\n")[actual.sourceLine - 1],
                ),
              0,
            );
            results.push({
              id: example.id,
              runtime,
              output,
              passed,
              criticalErrors,
              ...(toolcheck
                ? {
                    toolCalls,
                    toolResponses,
                    attempts: log.attempts,
                    projectCount: projects.length,
                  }
                : {}),
            });
          } catch (error) {
            log.status = "failed";
            log.errorCode =
              typeof error === "object" && error && "code" in error
                ? String(error.code)
                : "VERIFICATION_FAILED";
            results.push({
              id: example.id,
              runtime,
              errorCode: log.errorCode,
              ...(toolcheck
                ? {
                    toolCalls,
                    toolResponses,
                    attempts: log.attempts,
                    projectCount: projects.length,
                  }
                : {}),
            });
          } finally {
            log.durationMs = Math.round(performance.now() - start);
            saveLog();
            samples[runtime]!.push({
              id: example.id,
              durationMs: log.durationMs,
              inputTokens: log.inputTokens,
              outputTokens: log.outputTokens,
              passed,
              criticalErrors,
            });
            writeFileSync(
              path,
              JSON.stringify({ corpusHash, results, samples }, null, 2),
            );
            console.log(
              JSON.stringify({
                id: example.id,
                passed,
                criticalErrors,
                runtime,
                status: log.status,
                attempts: log.attempts,
                durationMs: log.durationMs,
                inputTokens: log.inputTokens,
                outputTokens: log.outputTokens,
                errorCode: log.errorCode,
              }),
            );
          }
        }
      }
      if (benchmark) {
        const run = (runtime: string) => ({
          model: config.model,
          corpusHash,
          inputKind: "text",
          actualModel: true,
          samples: samples[runtime],
        });
        const baseline = run("legacy"),
          candidate = run("sdk");
        const comparison = compareAssistantRuns(baseline, candidate);
        writeFileSync(
          path,
          JSON.stringify(
            { corpusHash, results, baseline, candidate, comparison },
            null,
            2,
          ),
        );
        console.log(JSON.stringify({ comparison }));
        if (comparison.status !== "passed") process.exitCode = 1;
      } else if (
        samples.legacy!.some((item) => !item.passed) ||
        samples.sdk!.some((item) => !item.passed)
      )
        process.exitCode = 1;
      console.log(JSON.stringify({ evidence: path }));
    }
  }
} catch {
  console.error(
    "Verification stopped: configuration, allowance or local evidence could not be validated. No secrets are printed.",
  );
  process.exitCode = 1;
} finally {
  db.close();
}
