import type {
  ModelLog,
  ModelUsage,
} from "../../../../packages/domain/admin.js";
import type { Repository } from "../database.js";

/** Replace the final reading for this attempt; never add a duplicate callback. */
export function recordModelCallUsage(
  log: ModelLog,
  usage: { inputTokens: number | null; outputTokens: number | null },
) {
  if (!Number.isSafeInteger(log.attempts) || log.attempts < 1)
    throw new Error("Usage requires a reserved model attempt");
  const valid = (value: number | null) =>
    value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const call = {
    attempt: log.attempts,
    inputTokens: valid(usage.inputTokens),
    outputTokens: valid(usage.outputTokens),
  };
  const calls = log.callUsage ?? [];
  const previous = calls.findIndex((entry) => entry.attempt === call.attempt);
  if (previous === -1) calls.push(call);
  else calls[previous] = call;
  log.callUsage = calls;
  log.meteredAttempts = calls.filter(
    (entry) => entry.inputTokens !== null && entry.outputTokens !== null,
  ).length;
  const total = (field: "inputTokens" | "outputTokens") => {
    const readings = calls.flatMap((entry) =>
      entry[field] === null ? [] : [entry[field]],
    );
    return readings.length
      ? readings.reduce((sum, value) => sum + value, 0)
      : null;
  };
  log.inputTokens = total("inputTokens");
  log.outputTokens = total("outputTokens");
}

/** Only provider-reported real usage; never estimate unknown or simulated usage. */
export async function readModelUsage(
  repo: Repository,
  workspaceId: string,
): Promise<ModelUsage> {
  const cte = `WITH logs AS (
    SELECT created_at, id, data::jsonb AS payload
    FROM model_logs WHERE workspace_id=? AND data::jsonb->>'mode'='real'
  ), usage AS (
    SELECT created_at, id, payload->>'status' AS status,
      payload->>'model' AS model,
      CASE WHEN jsonb_typeof(payload->'attempts')='number'
        THEN (payload->>'attempts')::numeric ELSE 1 END AS attempts,
      CASE WHEN jsonb_typeof(payload->'meteredAttempts')='number'
        THEN (payload->>'meteredAttempts')::numeric END AS metered_attempts,
      CASE WHEN jsonb_typeof(payload->'inputTokens')='number' AND payload->>'inputTokens' ~ '^[0-9]+$'
        THEN (payload->>'inputTokens')::numeric END AS input_tokens,
      CASE WHEN jsonb_typeof(payload->'outputTokens')='number' AND payload->>'outputTokens' ~ '^[0-9]+$'
        THEN (payload->>'outputTokens')::numeric END AS output_tokens
    FROM logs
  )`;
  const row = (await repo.db
    .prepare(
      `${cte} SELECT
    coalesce(sum(CASE WHEN status!='started' THEN input_tokens END),0) AS input,
    coalesce(sum(CASE WHEN status!='started' THEN output_tokens END),0) AS output,
    count(CASE WHEN status!='started' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND (attempts<=1 OR metered_attempts=attempts) THEN 1 END) AS measured,
    count(CASE WHEN status!='started' AND (input_tokens IS NULL OR output_tokens IS NULL OR (attempts>1 AND coalesce(metered_attempts,0)!=attempts)) THEN 1 END) AS unknown,
    count(CASE WHEN status='started' THEN 1 END) AS pending FROM usage`,
    )
    .get(workspaceId))!;
  const last = await repo.db
    .prepare(
      `${cte} SELECT * FROM usage WHERE status!='started' ORDER BY created_at DESC,id DESC LIMIT 1`,
    )
    .get(workspaceId);
  const inputTokens = Number(row.input),
    outputTokens = Number(row.output);
  const speech = (await repo.db
    .prepare(
      `SELECT count(*) AS requests,
        coalesce(sum(CASE WHEN jsonb_typeof(data::jsonb->'audioSeconds')='number'
          THEN (data::jsonb->>'audioSeconds')::numeric ELSE 0 END),0) AS seconds,
        count(*) FILTER (WHERE jsonb_typeof(data::jsonb->'audioSeconds') IS DISTINCT FROM 'number') AS unknown
       FROM model_logs WHERE workspace_id=? AND data::jsonb->>'mode'='real'
         AND data::jsonb->>'purpose'='speech-transcription' AND data::jsonb->>'status'!='started'`,
    )
    .get(workspaceId))!;
  return {
    ...(Number(speech.requests)
      ? {
          speech: {
            recordedSeconds: Number(speech.seconds),
            requests: Number(speech.requests),
            unmeasuredRequests: Number(speech.unknown ?? 0),
          },
        }
      : {}),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    measuredRequests: Number(row.measured),
    unmeasuredRequests: Number(row.unknown),
    pendingRequests: Number(row.pending),
    last: last
      ? {
          createdAt: String(last.created_at),
          model: last.model === null ? null : String(last.model),
          inputTokens:
            last.input_tokens === null ? null : Number(last.input_tokens),
          outputTokens:
            last.output_tokens === null ? null : Number(last.output_tokens),
        }
      : null,
  };
}
