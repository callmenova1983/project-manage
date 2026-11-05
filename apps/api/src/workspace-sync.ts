import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor } from "../../../packages/domain/types.js";
import { receiptInput } from "../../../packages/domain/workspace-sync.js";
import type { Repository } from "./database.js";
import { sessionActor } from "./auth.js";
import { z } from "zod";

/** Hints are disposable. Durable versions, always read with the data, repair lost hints. */
export function registerWorkspaceSync(
  app: FastifyInstance,
  repo: Repository,
  identity: (req: FastifyRequest) => { actor: Actor; csrf: string },
  wakeNotifications: () => void,
) {
  const clients = new Set<{
    actor: Actor;
    send: (data: string) => void;
    close: () => void;
  }>();
  let stopped = false,
    closeListener: (() => Promise<void>) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  async function listen() {
    if (stopped) return;
    const reconnect = () => {
      if (stopped || retry) return;
      retry = setTimeout(() => {
        const previous = closeListener;
        closeListener = undefined;
        void Promise.resolve(previous?.())
          .catch(() => {})
          .then(() => {
            retry = undefined;
            return listen();
          });
      }, 1000);
      retry.unref();
    };
    try {
      closeListener = await repo.db.listen((payload) => {
        try {
          const event = JSON.parse(payload);
          if (event.schema !== repo.db.schema) return;
          if (["core", "directory", "jobs"].includes(event.domain))
            wakeNotifications();
          if (event.domain === "jobs") return;
          const hint = JSON.stringify({
            domain: event.domain,
            version: event.version,
          });
          for (const client of clients) {
            if (
              client.actor.workspaceId === event.workspaceId &&
              (!event.userId || client.actor.id === event.userId)
            )
              client.send(hint);
          }
        } catch {
          /* A malformed hint is recovered by metadata calibration. */
        }
      }, reconnect);
      if (stopped) {
        await closeListener();
        closeListener = undefined;
      }
    } catch {
      reconnect();
    }
  }
  app.addHook("onReady", listen);
  app.addHook("preClose", async () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    for (const client of [...clients]) client.close();
    await closeListener?.();
  });
  app.get("/api/bootstrap", async (req) =>
    repo.db.readSnapshot(async () => {
      const { actor, csrf } = identity(req);
      const versions = await repo.syncVersions(actor.workspaceId, actor.id);
      const account = await repo.db
        .prepare(
          "SELECT following FROM notification_accounts WHERE workspace_id=? AND user_id=?",
        )
        .get(actor.workspaceId, actor.id);
      return {
        actor,
        csrf,
        versions,
        core: await repo.core(actor.workspaceId),
        followingIds: account ? JSON.parse(String(account.following)) : [],
      };
    }),
  );
  app.get("/api/workspace/core", async (req) =>
    repo.db.readSnapshot(async () => {
      const { actor } = identity(req);
      const { knownVersion } = z
        .object({ knownVersion: z.string().max(100).optional() })
        .parse(req.query);
      const version = (await repo.syncVersions(actor.workspaceId, actor.id))
        .core;
      return knownVersion === version
        ? { version, unchanged: true }
        : {
            version,
            unchanged: false,
            core: await repo.core(actor.workspaceId),
          };
    }),
  );
  app.get("/api/workspace/meta", async (req) => {
    const { actor } = identity(req);
    return repo.syncVersions(actor.workspaceId, actor.id);
  });
  app.get("/api/projects/:id/members", async (req) => {
    const { actor } = identity(req),
      { id } = z.object({ id: z.string().max(100) }).parse(req.params);
    return repo.db.readSnapshot(async () => ({
      version: (await repo.syncVersions(actor.workspaceId, actor.id))
        .projectMembers,
      members: await repo.projectMembers(actor.workspaceId, id),
    }));
  });
  app.post("/api/activity/receipts", async (req) =>
    repo.receipts(
      identity(req).actor.workspaceId,
      receiptInput.parse(req.body),
    ),
  );
  app.get("/api/workspace/events", async (req, reply) => {
    if (process.env.PM_SSE === "0")
      return reply.code(503).send({ message: "Live synchronization disabled" });
    if (req.headers.authorization)
      return reply.code(403).send({ message: "Use the signed-in browser" });
    const { actor } = identity(req);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    let checking = false,
      closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clients.delete(client);
      reply.raw.end();
    };
    const send = (data: string) => {
      if (closed) return;
      // Slow clients reconnect and recover from metadata instead of growing memory.
      if (!reply.raw.write(`data: ${data}\n\n`)) close();
    };
    const client = { actor, send, close };
    const heartbeat = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void sessionActor(repo, req.cookies.pm_session)
        .then((session) => {
          if (
            session.actor.id !== actor.id ||
            session.actor.workspaceId !== actor.workspaceId
          )
            close();
          else if (!reply.raw.write(": heartbeat\n\n")) close();
        })
        .catch(close)
        .finally(() => {
          checking = false;
        });
    }, 15000);
    heartbeat.unref();
    clients.add(client);
    reply.raw.on("close", close);
    send(JSON.stringify({ domain: "calibrate" }));
  });
}
