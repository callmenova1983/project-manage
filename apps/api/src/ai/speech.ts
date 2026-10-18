import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DEFAULT_SPEECH_MODEL,
  MAX_SPEECH_SECONDS,
  speechInput,
  type SpeechCapabilities,
  type SpeechTranscript,
} from "../../../../packages/domain/speech.js";
import type { Actor } from "../../../../packages/domain/types.js";
import type { ModelLog } from "../../../../packages/domain/admin.js";
import type { QwenConfig } from "./config.js";
import type { Repository } from "../database.js";
import { allowanceReason } from "./allowance.js";
import { writeModelLog } from "../admin.js";
import { AiError } from "./provider.js";

/** Our recorder sends PCM16/16kHz mono WAV, independent of mobile codecs. */
export function validateSpeechWav(data: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new AiError(400, "ASR_INVALID_AUDIO", "录音数据无效，请重新录音。");
  const bytes = Buffer.from(data, "base64");
  if (
    bytes.length < 46 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.toString("ascii", 12, 16) !== "fmt " ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== 16000 ||
    bytes.readUInt32LE(28) !== 32000 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString("ascii", 36, 40) !== "data" ||
    bytes.readUInt32LE(40) !== bytes.length - 44 ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    (bytes.length - 44) % 2
  )
    throw new AiError(
      400,
      "ASR_INVALID_AUDIO",
      "录音格式无效，请使用输入框中的麦克风重新录音。",
    );
  const seconds = (bytes.length - 44) / 32000;
  if (seconds < 0.2 || seconds > MAX_SPEECH_SECONDS + 1)
    throw new AiError(400, "ASR_AUDIO_LIMIT", "请录制 0.2 秒至 2 分钟的语音。");
  return seconds;
}
export function registerSpeechRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  getConfig: (actor: Actor) => QwenConfig | undefined,
  fetcher: typeof fetch = fetch,
) {
  const used = (config: QwenConfig) =>
    Number(
      repo.db
        .prepare("SELECT count(*) AS n FROM ai_attempts WHERE budget_id=?")
        .get(config.budgetId)!.n,
    );
  function availability(config?: QwenConfig): SpeechCapabilities {
    const reason = allowanceReason(config, config ? used(config) : 0);
    return {
      enabled: !reason,
      model: DEFAULT_SPEECH_MODEL,
      maxSeconds: MAX_SPEECH_SECONDS,
      reason:
        reason === "disabled"
          ? "请先在管理设置中启用百炼模型凭据。"
          : reason === "expired"
            ? "模型调用额度已过期，请管理员续期。"
            : reason === "exhausted"
              ? "模型调用额度已用完，请管理员调整额度。"
              : null,
    };
  }
  app.get("/api/assistant/speech", (req) =>
    availability(getConfig(actor(req))),
  );
  app.post(
    "/api/assistant/transcribe",
    {
      bodyLimit: 6 * 1024 * 1024,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (req) => {
      const a = actor(req),
        input = speechInput.parse(req.body);
      validateSpeechWav(input.data);
      const hash = createHash("sha256")
        .update("assistant-asr:" + input.data)
        .digest("hex");
      const previous = repo.db
        .prepare(
          "SELECT request_hash,status,response FROM ai_requests WHERE user_id=? AND key=?",
        )
        .get(a.id, input.requestId);
      if (previous) {
        if (previous.request_hash !== hash)
          throw new AiError(
            409,
            "ASR_REQUEST_CONFLICT",
            "录音请求已用于其他内容，请重新录音。",
          );
        if (previous.status === "succeeded")
          return JSON.parse(String(previous.response)) as SpeechTranscript;
        throw new AiError(
          409,
          previous.status === "started" ? "ASR_RUNNING" : "ASR_PREVIOUS_FAILED",
          previous.status === "started"
            ? "这段语音仍在识别，请稍后查看识别结果。"
            : "上次识别未成功。录音仍在本机，可点击重试发起新的识别。",
        );
      }
      const config = getConfig(a),
        capability = availability(config);
      if (!config || !capability.enabled)
        throw new AiError(
          503,
          "ASR_UNAVAILABLE",
          capability.reason || "语音识别暂不可用。",
        );
      const log: ModelLog & { audioSeconds?: number | null; purpose: string } =
        {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          actor: a.name,
          provider: "qwen",
          model: DEFAULT_SPEECH_MODEL,
          mode: "real",
          status: "started",
          durationMs: null,
          inputTokens: null,
          outputTokens: null,
          cost: null,
          errorCode: null,
          attempts: 1,
          audioSeconds: null,
          purpose: "speech-transcription",
        };
      // Reserve before the network call. A restart never replays an uncertain bill.
      repo.transaction(() => {
        const check = availability(config);
        if (!check.enabled)
          throw new AiError(503, "ASR_UNAVAILABLE", check.reason!);
        repo.db
          .prepare(
            "INSERT INTO ai_requests(user_id,key,request_hash,status,created_at) VALUES(?,?,?,'started',?)",
          )
          .run(a.id, input.requestId, hash, Date.now());
        repo.db
          .prepare(
            "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
          )
          .run(randomUUID(), config.budgetId, a.id, Date.now());
        writeModelLog(repo, a.workspaceId, log);
      });
      const started = performance.now();
      try {
        const response = await fetcher(config.baseUrl + "/chat/completions", {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: DEFAULT_SPEECH_MODEL,
            stream: false,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "input_audio",
                    input_audio: {
                      data: `data:audio/wav;base64,${input.data}`,
                    },
                  },
                ],
              },
            ],
            asr_options: { enable_itn: true },
          }),
          signal: AbortSignal.timeout(
            Math.min(60000, Math.max(15000, config.timeoutMs)),
          ),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AiError(
            502,
            "ASR_PROVIDER_ERROR",
            response.status === 401 || response.status === 403
              ? "百炼拒绝了语音模型请求，请管理员检查 ASR 模型权限与凭据。"
              : "云端语音识别暂时不可用，录音已保留在本机，可稍后重试。",
          );
        }
        const length = Number(response.headers.get("content-length"));
        if (length > 100000) {
          await response.body?.cancel();
          throw new AiError(
            502,
            "ASR_INVALID_OUTPUT",
            "语音识别返回过长，请分段录入。",
          );
        }
        const raw = await response.text();
        if (raw.length > 100000)
          throw new AiError(
            502,
            "ASR_INVALID_OUTPUT",
            "语音识别返回过长，请分段录入。",
          );
        const parsed = z
          .object({
            choices: z
              .array(
                z.object({
                  message: z.object({ content: z.string().max(20000) }),
                }),
              )
              .min(1),
            usage: z
              .object({
                prompt_tokens: z.number().int().nonnegative().optional(),
                completion_tokens: z.number().int().nonnegative().optional(),
                seconds: z.number().nonnegative().optional(),
              })
              .optional(),
          })
          .safeParse(JSON.parse(raw));
        if (!parsed.success)
          throw new AiError(
            502,
            "ASR_INVALID_OUTPUT",
            "云端未返回有效识别文字，请重试。",
          );
        const text = parsed.data.choices[0]!.message.content.trim();
        log.inputTokens = parsed.data.usage?.prompt_tokens ?? null;
        log.outputTokens = parsed.data.usage?.completion_tokens ?? null;
        log.audioSeconds = parsed.data.usage?.seconds ?? null;
        if (!text)
          throw new AiError(
            422,
            "ASR_NO_SPEECH",
            "没有识别到清晰语音，请靠近麦克风再试一次。",
          );
        const result: SpeechTranscript = {
          requestId: input.requestId,
          text,
          model: DEFAULT_SPEECH_MODEL,
          seconds: log.audioSeconds,
        };
        log.status = "succeeded";
        repo.db
          .prepare(
            "UPDATE ai_requests SET status='succeeded',response=? WHERE user_id=? AND key=?",
          )
          .run(JSON.stringify(result), a.id, input.requestId);
        return result;
      } catch (e) {
        log.status = "failed";
        const error =
          e instanceof AiError
            ? e
            : new AiError(
                502,
                "ASR_CONNECTION",
                "语音识别连接中断，录音仍在本机，可稍后重试。",
              );
        log.errorCode = error.code;
        repo.db
          .prepare(
            "UPDATE ai_requests SET status='failed' WHERE user_id=? AND key=?",
          )
          .run(a.id, input.requestId);
        throw error;
      } finally {
        log.durationMs = Math.round(performance.now() - started);
        writeModelLog(repo, a.workspaceId, log);
      }
    },
  );
}
