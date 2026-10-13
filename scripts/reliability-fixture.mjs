import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir, cpus, totalmem, platform, release } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { Repository } from "../dist/server/apps/api/src/database.js";
import { createUser } from "../dist/server/apps/api/src/auth.js";
import { createSeed } from "../dist/server/packages/domain/seed.js";
import {
  leafTasks,
  projectInput,
  taskInput,
  validateGraph,
} from "../dist/server/packages/domain/types.js";

/** Private disposable database, random credentials, loopback only, real model disabled. */
export async function fixture(projectCount = 20, tasksPerProject = 0) {
  const dir = mkdtempSync(join(tmpdir(), "pm-reliability-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`,
    path = join(dir, "synthetic.sqlite");
  const repo = new Repository(path),
    seed = createSeed();
  repo.workspace("reliability", "Synthetic reliability workspace");
  const projects = Array.from({ length: projectCount }, (_, i) => ({
    ...seed.projects[i % seed.projects.length],
    id: `scale-${i + 1}`,
    name: `Synthetic project ${String(i + 1).padStart(3, "0")}`,
    aliases: [],
    notes: "Synthetic initial note",
    latestUpdate: "Synthetic baseline report",
  }));
  const leaves = leafTasks(seed.tasks);
  const tasks = projects.flatMap((p, i) =>
    Array.from({ length: tasksPerProject }, (_, j) => ({
      ...leaves[(i * tasksPerProject + j) % leaves.length],
      id: `scale-task-${i + 1}-${j + 1}`,
      projectId: p.id,
      parentId: null,
      title: `Synthetic work ${i + 1}/${j + 1}`,
    })),
  );
  for (const p of projects) projectInput.strip().parse(p);
  for (const t of tasks) taskInput.strip().parse(t);
  validateGraph(projects, tasks);
  repo.transaction(() => {
    for (const p of projects) repo.putProject("reliability", p);
    for (const t of tasks) repo.putTask("reliability", t);
  });
  const credentials = [];
  for (let i = 0; i < 5; i++) {
    const credential = {
      email: `synthetic-${i}@example.test`,
      password: randomBytes(24).toString("hex"),
    };
    await createUser(repo, {
      ...credential,
      name: `Synthetic member ${i + 1}`,
      workspaceId: "reliability",
    });
    credentials.push(credential);
  }
  repo.close();
  const child = spawn(process.execPath, ["dist/server/apps/api/src/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_ORIGIN: origin,
      DATABASE_PATH: path,
      AI_PROVIDER: "rules",
      AI_CALLS_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  const close = async () => {
    if (browser) await browser.close();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Compiled fixture did not start")),
        15000,
      );
      child.stdout.on("data", (data) => {
        if (data.toString().includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Fixture exited ${code}`));
      });
    });
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    });
    return {
      browser,
      origin,
      path,
      projects,
      tasks,
      close,
      environment: {
        node: process.version,
        chromium: browser.version(),
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryGiB: +(totalmem() / 2 ** 30).toFixed(2),
        viewport: "1536x1024",
        network: "loopback, no throttling",
        build: "compiled Vite + Node/Fastify/SQLite, local HTTP",
      },
      async session(index, width = 1536) {
        const context = await browser.newContext({
          baseURL: origin,
          viewport: { width, height: width < 500 ? 844 : 1024 },
        });
        const response = await context.request.post("/api/auth/login", {
          data: credentials[index],
        });
        expect(response.status()).toBe(200);
        const auth = await response.json();
        return { context, page: await context.newPage(), auth };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
