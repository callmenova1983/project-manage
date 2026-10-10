import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { Repository } from "../dist/server/apps/api/src/database.js";
import { createUser } from "../dist/server/apps/api/src/auth.js";
import { projectInput } from "../dist/server/packages/domain/types.js";
const dir = mkdtempSync(join(tmpdir(), "pm-built-"));
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`,
  path = join(dir, "test.sqlite");
const repo = new Repository(path);
repo.seed("smoke");
const password = randomBytes(24).toString("hex");
await createUser(repo, {
  email: "smoke@example.test",
  name: "Smoke Member",
  password,
  workspaceId: "smoke",
});
repo.close();
let child;
let browser;
async function start() {
  child = spawn(process.execPath, ["dist/server/apps/api/src/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_ORIGIN: origin,
      DATABASE_PATH: path,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Built server did not start")),
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
      reject(new Error(`Built server exited ${code}`));
    });
  });
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}
try {
  await start();
  assert.equal((await fetch(origin + "/api/health")).status, 200);
  assert.equal((await fetch(origin + "/api/workspace")).status, 401);
  const html = await (await fetch(origin + "/projects")).text();
  assert.ok(html.includes("Project Manage") && html.includes("/assets/"));
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1536, height: 1024 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("401"))
      errors.push(m.text());
  });
  await page.goto(origin);
  await page.getByLabel("Email", { exact: true }).fill("smoke@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Projects 20", exact: true })
    .waitFor();
  mkdirSync("artifacts", { recursive: true });
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/desktop-projects.png" });
  const firstRow = await page.locator(".project-row").first().boundingBox();
  writeFileSync(
    "artifacts/layout-metrics.json",
    JSON.stringify(
      {
        firstRow,
        referenceFirstRowY: 190,
        viewport: { width: 1536, height: 1024 },
      },
      null,
      2,
    ),
  );
  await page
    .getByRole("link", { name: "Atlas Customer Portal", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Atlas Customer Portal", exact: true })
    .waitFor();
  await page.screenshot({ path: "artifacts/project-detail.png" });
  await page.getByRole("link", { name: "All tasks", exact: true }).click();
  await page.getByRole("heading", { name: "Tasks", exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/weekly-tasks.png" });
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("link", { name: "Meeting notes", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Meeting notes", exact: true })
    .fill("Atlas and Meridian: review joint handoff");
  await page
    .getByRole("button", { name: "Review suggestions", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "1 suggestions · 0 selected" })
    .waitFor();
  await page.screenshot({ path: "artifacts/meeting-review.png" });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/mobile-projects.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const session = await (
    await page.request.get(origin + "/api/auth/session")
  ).json();
  const project = await (
    await page.request.get(origin + "/api/projects/project-1")
  ).json();
  const saved = await page.request.put(origin + "/api/projects/project-1", {
    headers: { "x-csrf-token": session.csrf, "idempotency-key": randomUUID() },
    data: {
      ...projectInput.strip().parse(project),
      notes: "Persisted across actual process restart",
      version: project.version,
    },
  });
  assert.equal(saved.status(), 200);
  await stop();
  await start();
  const restored = await (
    await page.request.get(origin + "/api/projects/project-1")
  ).json();
  assert.equal(restored.notes, "Persisted across actual process restart");
  assert.deepEqual(errors, []);
  const result = {
    build: "passed",
    staticRouting: "passed",
    authenticatedBrowser: "passed",
    processRestartPersistence: "passed",
    unexpectedConsoleErrors: errors.length,
    chromium: browser.version(),
  };
  writeFileSync(
    "artifacts/built-runtime.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
