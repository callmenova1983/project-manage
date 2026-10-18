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
export function readModelUsage(
  repo: Repository,
  workspaceId: string,
): ModelUsage {
  const cte = `WITH usage AS (
    SELECT created_at, id, json_extract(data,'$.status') AS status,
      json_extract(data,'$.model') AS model,
      coalesce(json_extract(data,'$.attempts'),1) AS attempts,
      json_extract(data,'$.meteredAttempts') AS metered_attempts,
      CASE WHEN json_type(data,'$.inputTokens')='integer' AND json_extract(data,'$.inputTokens')>=0
        THEN json_extract(data,'$.inputTokens') END AS input_tokens,
      CASE WHEN json_type(data,'$.outputTokens')='integer' AND json_extract(data,'$.outputTokens')>=0
        THEN json_extract(data,'$.outputTokens') END AS output_tokens
    FROM model_logs WHERE workspace_id=? AND json_extract(data,'$.mode')='real'
  )`;
  const row = repo.db
    .prepare(
      `${cte} SELECT
    coalesce(sum(CASE WHEN status!='started' THEN input_tokens END),0) AS input,
    coalesce(sum(CASE WHEN status!='started' THEN output_tokens END),0) AS output,
    count(CASE WHEN status!='started' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND (attempts<=1 OR metered_attempts=attempts) THEN 1 END) AS measured,
    count(CASE WHEN status!='started' AND (input_tokens IS NULL OR output_tokens IS NULL OR (attempts>1 AND coalesce(metered_attempts,0)!=attempts)) THEN 1 END) AS unknown,
    count(CASE WHEN status='started' THEN 1 END) AS pending FROM usage`,
    )
    .get(workspaceId)!;
  const last = repo.db
    .prepare(
      `${cte} SELECT * FROM usage WHERE status!='started' ORDER BY created_at DESC,id DESC LIMIT 1`,
    )
    .get(workspaceId);
  const inputTokens = Number(row.input),
    outputTokens = Number(row.output);
  const speech = repo.db
    .prepare(
      "SELECT count(*) AS requests, coalesce(sum(CASE WHEN json_type(data,'$.audioSeconds') IN ('integer','real') THEN json_extract(data,'$.audioSeconds') ELSE 0 END),0) AS seconds, sum(CASE WHEN json_type(data,'$.audioSeconds') NOT IN ('integer','real') OR json_type(data,'$.audioSeconds') IS NULL THEN 1 ELSE 0 END) AS unknown FROM model_logs WHERE workspace_id=? AND json_extract(data,'$.mode')='real' AND json_extract(data,'$.purpose')='speech-transcription' AND json_extract(data,'$.status')!='started'",
    )
    .get(workspaceId)!;
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
