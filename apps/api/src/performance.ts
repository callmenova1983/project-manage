import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";
export const requestTiming = new AsyncLocalStorage<{
  start: number;
  db: number;
  queries: number;
  auth: number;
  assembly: number;
}>();
export async function timedQuery<T>(run: () => Promise<T>): Promise<T> {
  const timing = requestTiming.getStore(),
    start = performance.now();
  try {
    return await run();
  } finally {
    if (timing) {
      timing.db += performance.now() - start;
      timing.queries++;
    }
  }
}
/** Non-query time spent building the core response (including pool/transaction overhead). */
export async function timedAssembly<T>(run: () => Promise<T>): Promise<T> {
  const timing = requestTiming.getStore(),
    start = performance.now(),
    db = timing?.db ?? 0;
  try {
    return await run();
  } finally {
    if (timing)
      timing.assembly += Math.max(
        0,
        performance.now() - start - (timing.db - db),
      );
  }
}
export function registerPerformance(app: FastifyInstance) {
  app.addHook("onRequest", (_req, _reply, done) => {
    requestTiming.run(
      { start: performance.now(), db: 0, queries: 0, auth: 0, assembly: 0 },
      done,
    );
  });
  app.addHook("onSend", async (req, reply, body) => {
    const timing = requestTiming.getStore();
    if (!timing || !req.url.startsWith("/api/")) return body;
    const elapsed = performance.now() - timing.start;
    reply.header(
      "Server-Timing",
      `auth;dur=${timing.auth.toFixed(1)}, db;dur=${timing.db.toFixed(1)}, app;dur=${Math.max(0, elapsed - timing.db).toFixed(1)}, assembly;dur=${timing.assembly.toFixed(1)}, total;dur=${elapsed.toFixed(1)}`,
    );
    const bytes =
      typeof body === "string"
        ? Buffer.byteLength(body)
        : Buffer.isBuffer(body)
          ? body.length
          : undefined;
    if (process.env.PM_PERFORMANCE_LOG === "1")
      console.info(
        JSON.stringify({
          type: "api-performance",
          route: req.routeOptions.url,
          method: req.method,
          status: reply.statusCode,
          durationMs: elapsed,
          authMs: timing.auth,
          dbMs: timing.db,
          assemblyMs: timing.assembly,
          queries: timing.queries,
          responseBytes: bytes,
        }),
      );
    return body;
  });
}
