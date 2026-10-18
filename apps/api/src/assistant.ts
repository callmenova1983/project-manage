import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  answerAssistantQuery,
  assistantQueryInput,
  assistantSessionInput,
  type AssistantSession,
} from "../../../packages/domain/assistant.js";
import type { Actor } from "../../../packages/domain/types.js";
import { Repository, HttpError } from "./database.js";
import type { Mutate } from "./intake.js";

export function registerAssistantRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (r: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  const read = (a: Actor): AssistantSession => {
    const row = repo.db
      .prepare(
        "SELECT version,updated_at,data FROM assistant_sessions WHERE workspace_id=? AND user_id=?",
      )
      .get(a.workspaceId, a.id);
    if (!row) return { version: 0, updatedAt: null, state: {} };
    const state = JSON.parse(String(row.data)) as Record<string, unknown>;
    const proposal = state.proposal as { id?: unknown } | null;
    if (proposal && typeof proposal.id === "string") {
      const saved = repo.db
        .prepare("SELECT data FROM proposals WHERE workspace_id=? AND id=?")
        .get(a.workspaceId, proposal.id);
      if (saved) state.proposal = JSON.parse(String(saved.data));
    }
    return {
      version: Number(row.version),
      updatedAt: String(row.updated_at),
      state,
    };
  };
  app.get("/api/assistant/session", (req) => read(actor(req)));
  app.put("/api/assistant/session", { bodyLimit: 3 * 1024 * 1024 }, (req) =>
    mutate(req, (a) => {
      const input = assistantSessionInput.parse(req.body);
      const current = read(a);
      if (current.version !== input.version)
        throw new HttpError(
          409,
          "另一端已更新对话，请先恢复云端会话；当前草稿仍保留。",
          current,
        );
      const updatedAt = new Date().toISOString();
      const version = current.version + 1;
      repo.db
        .prepare(
          "INSERT INTO assistant_sessions(workspace_id,user_id,version,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at,data=excluded.data",
        )
        .run(
          a.workspaceId,
          a.id,
          version,
          updatedAt,
          JSON.stringify(input.state),
        );
      return {
        version,
        updatedAt,
        state: input.state,
      } satisfies AssistantSession;
    }),
  );
  app.post("/api/assistant/query", (req) => {
    const a = actor(req);
    const input = assistantQueryInput.parse(req.body);
    const snapshot = repo.snapshot(a.workspaceId);
    if (
      input.projectId &&
      !snapshot.projects.some((p) => p.id === input.projectId)
    )
      throw new HttpError(404, "Project not found");
    return answerAssistantQuery(input, snapshot, a);
  });
}
