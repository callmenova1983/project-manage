/** Small local-only comparison, never a production load test or a p95 claim. */
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildApp } from "../apps/api/src/app.js";
import { createUser } from "../apps/api/src/auth.js";
import { createSeed } from "../packages/domain/seed.js";
import type { Project, Task, Activity } from "../packages/domain/types.js";
if (!["127.0.0.1", "localhost", "::1"].includes(process.env.DB_HOST ?? ""))
  throw new Error(
    "Set DB_HOST to a local PostgreSQL server; this script refuses remote databases.",
  );
const context = await buildApp({
  isolatedDatabase: true,
  origin: "http://localhost:4173",
  notificationIntervalMs: 0,
});
try {
  await context.repo.seed("performance-smoke");
  const seed = createSeed();
  const projects: Project[] = Array.from({ length: 167 }, (_, index) => ({
    ...seed.projects[index % seed.projects.length]!,
    id: `perf-project-${index}`,
    name: `项目 ${index} ${seed.projects[index % seed.projects.length]!.name}`,
    ownerId: null,
    participantIds: [],
  }));
  const tasks: Task[] = Array.from({ length: 212 }, (_, index) => ({
    ...seed.tasks[index % seed.tasks.length]!,
    id: `perf-task-${index}`,
    projectId: projects[index % projects.length]!.id,
    parentId: null,
    assigneeId: null,
    dependencies: [],
  }));
  await context.repo.transaction(async () => {
    await context.repo.db
      .prepare("DELETE FROM tasks WHERE workspace_id=?")
      .run("performance-smoke");
    await context.repo.db
      .prepare("DELETE FROM activities WHERE workspace_id=?")
      .run("performance-smoke");
    await context.repo.db
      .prepare("DELETE FROM projects WHERE workspace_id=?")
      .run("performance-smoke");
    for (const project of projects)
      await context.repo.putProject("performance-smoke", project);
    for (const task of tasks)
      await context.repo.putTask("performance-smoke", task);
    for (let index = 0; index < 500; index++) {
      const task = tasks[index % tasks.length]!;
      const activity: Activity = {
        id: `perf-event-${index}`,
        kind: "task",
        entityId: task.id,
        projectId: task.projectId,
        actor: "Synthetic tester",
        action: "Updated task",
        source: "Local performance fixture",
        createdAt: new Date(Date.now() - index * 60000).toISOString(),
        before: { ...task, version: index + 1 },
        after: { ...task, version: index + 2 },
      };
      await context.repo.audit("performance-smoke", activity);
    }
  });
  const password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    workspaceId: "performance-smoke",
    email: "performance@example.test",
    name: "Synthetic tester",
    password,
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: "http://localhost:4173" },
    payload: { email: "performance@example.test", password },
  });
  const headers = { cookie: `pm_session=${login.cookies[0]!.value}` };
  const bootstrap = await context.app.inject({
    url: "/api/bootstrap",
    headers,
  });
  const version = bootstrap.json().versions.core;
  const results = [];
  for (const url of [
    "/api/workspace",
    "/api/bootstrap",
    "/api/workspace/core",
    `/api/workspace/core?knownVersion=${version}`,
    "/api/workspace/meta",
    "/api/notifications",
  ]) {
    const samples: number[] = [];
    let rawBytes = 0,
      gzipBytes = 0,
      timing = "";
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      const response = await context.app.inject({ url, headers });
      if (response.statusCode !== 200)
        throw new Error(`${url}: ${response.statusCode}`);
      samples.push(performance.now() - start);
      rawBytes = Buffer.byteLength(response.body);
      gzipBytes = gzipSync(response.body, { level: 5 }).length;
      timing = String(response.headers["server-timing"]);
    }
    samples.sort((a, b) => a - b);
    results.push({
      route: url.split("?")[0],
      unchanged: url.includes("knownVersion"),
      samples: 5,
      medianMs: Number(samples[2]!.toFixed(2)),
      maxMs: Number(samples[4]!.toFixed(2)),
      rawBytes,
      gzipBytes,
      serverTiming: timing,
    });
  }
  await context.repo.db.exec("ANALYZE activities");
  const activityPlan = (
    await context.repo.db.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT data FROM activities WHERE workspace_id=$1 AND occurred_at<=$2::timestamptz
    ORDER BY occurred_at DESC,id COLLATE "C" ASC LIMIT 25`,
      ["performance-smoke", new Date().toISOString()],
    )
  ).rows[0]!["QUERY PLAN"];
  const pg = await context.repo.db.prepare("SHOW server_version").get();
  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    postgres: pg?.server_version,
    fixture: { projects: 167, tasks: 212, activities: 500 },
    scope:
      "Local injected API, five warm samples, gzip calculated at level 5; excludes browser, network, Nginx and production data. No p95 claim.",
    results,
    activityPlan,
  };
  mkdirSync("artifacts/performance", { recursive: true });
  writeFileSync(
    "artifacts/performance/local-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.app.close();
}
