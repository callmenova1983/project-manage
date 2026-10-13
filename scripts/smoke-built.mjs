import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { Repository } from "../dist/server/apps/api/src/database.js";
import { createUser } from "../dist/server/apps/api/src/auth.js";
import { projectInput } from "../dist/server/packages/domain/types.js";
import { backupDatabase } from "../dist/server/apps/api/src/backup.js";
import { checkEntry } from "../dist/server/apps/api/src/entry-check.js";
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
await createUser(repo, {
  email: "second-smoke@example.test",
  name: "Second Synthetic Member",
  password,
  workspaceId: "smoke",
});
repo.close();
let child;
let browser;
async function start(databaseFile = path) {
  child = spawn(process.execPath, ["dist/server/apps/api/src/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_ORIGIN: origin,
      DATABASE_PATH: databaseFile,
      AI_PROVIDER: "rules",
      AI_CALLS_ENABLED: "false",
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
  const entry = await checkEntry(origin);
  assert.equal(entry.passed, true, JSON.stringify(entry));
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/entry-response.json",
    JSON.stringify(entry, null, 2),
  );
  assert.equal((await fetch(origin + "/api/health")).status, 200);
  assert.equal((await fetch(origin + "/api/workspace")).status, 401);
  const html = await (await fetch(origin + "/projects")).text();
  assert.ok(html.includes("Project Manage") && html.includes("/assets/"));
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
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
  const otherContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const otherLogin = await otherContext.request.post(
    origin + "/api/auth/login",
    {
      data: { email: "second-smoke@example.test", password },
      headers: { Origin: origin },
    },
  );
  assert.equal(otherLogin.status(), 200);
  const otherSession = await otherLogin.json();
  assert.notEqual(otherSession.actor.id, session.actor.id);
  const shared = await (
    await otherContext.request.get(origin + "/api/projects/project-1")
  ).json();
  assert.equal(shared.notes, "Persisted across actual process restart");
  const sharedSave = await otherContext.request.put(
    origin + "/api/projects/project-1",
    {
      headers: {
        Origin: origin,
        "x-csrf-token": otherSession.csrf,
        "idempotency-key": randomUUID(),
      },
      data: {
        ...projectInput.strip().parse(shared),
        latestUpdate: "Saved from a second independent member session",
        version: shared.version,
      },
    },
  );
  assert.equal(sharedSave.status(), 200);
  const synced = page.waitForResponse(
    (response) => response.url().endsWith("/api/workspace") && response.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await synced;
  await page
    .getByText("Saved from a second independent member session", {
      exact: true,
    })
    .waitFor();
  // The same built site can offer a demo even when this browser already owns
  // a real session. Demo edits must not use, clear or mutate that session/data.
  const serverBeforeDemo = await (
    await page.request.get(origin + "/api/workspace")
  ).json();
  const demoContext = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
  });
  const demoPage = await demoContext.newPage();
  const demoApiRequests = [];
  demoPage.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      demoApiRequests.push(request.url());
  });
  demoPage.on("pageerror", (error) => errors.push(error.message));
  demoPage.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await demoPage.goto(origin + "/demo/projects");
  await demoPage
    .getByRole("heading", { name: "Projects 20", exact: true })
    .waitFor();
  await demoPage
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  await demoPage
    .getByRole("button", { name: "Edit project", exact: true })
    .click();
  await demoPage
    .getByLabel("Latest reported update", { exact: true })
    .fill("Built browser demo persistence only");
  await demoPage
    .getByRole("button", { name: "Save project", exact: true })
    .click();
  await demoPage
    .getByRole("status")
    .filter({ hasText: "Project updated" })
    .waitFor();
  await demoPage.reload();
  await demoPage
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  await demoPage
    .getByRole("button", { name: "Edit project", exact: true })
    .click();
  assert.equal(
    await demoPage
      .getByLabel("Latest reported update", { exact: true })
      .inputValue(),
    "Built browser demo persistence only",
  );
  await demoPage.getByRole("button", { name: "Cancel", exact: true }).click();
  await demoPage
    .getByRole("link", { name: "Atlas Customer Portal", exact: true })
    .click();
  await demoPage.reload();
  await demoPage
    .getByRole("heading", { name: "Atlas Customer Portal", exact: true })
    .waitFor();
  await demoPage.goto(origin + "/demo/intake");
  await demoPage
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/intake.xlsx");
  await demoPage.getByText("intake.xlsx", { exact: true }).waitFor();
  await demoPage
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await demoPage
    .getByText("1 new projects · 2 new tasks", { exact: true })
    .waitFor();
  await demoPage.screenshot({
    path: "artifacts/intake-built-mobile.png",
    fullPage: true,
  });
  await demoPage
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await demoPage
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await demoPage
    .getByRole("heading", { name: "Created and recorded", exact: true })
    .waitFor();
  assert.deepEqual(demoApiRequests, []);
  assert.equal(
    (await demoContext.cookies()).find((cookie) => cookie.name === "pm_session")
      .value,
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "pm_session",
    ).value,
  );
  assert.deepEqual(
    await (await page.request.get(origin + "/api/workspace")).json(),
    serverBeforeDemo,
  );
  await demoContext.close();
  const backupPath = join(dir, "verified-backup.sqlite");
  await backupDatabase(path, backupPath);
  const beforeLateWrite = await (
    await page.request.get(origin + "/api/projects/project-1")
  ).json();
  const lateWrite = await page.request.put(origin + "/api/projects/project-1", {
    headers: { "x-csrf-token": session.csrf, "idempotency-key": randomUUID() },
    data: {
      ...projectInput.strip().parse(beforeLateWrite),
      notes: "Later write in the original database",
      version: beforeLateWrite.version,
    },
  });
  assert.equal(lateWrite.status(), 200);
  await stop();
  await start();
  const restarted = await (
    await page.request.get(origin + "/api/projects/project-1")
  ).json();
  assert.equal(restarted.notes, "Later write in the original database");
  await stop();
  await start(backupPath);
  const restored = await (
    await page.request.get(origin + "/api/projects/project-1")
  ).json();
  assert.equal(restored.notes, "Persisted across actual process restart");
  assert.equal(
    restored.latestUpdate,
    "Saved from a second independent member session",
  );
  assert.equal(
    (await otherContext.request.get(origin + "/api/workspace")).status(),
    200,
  );
  await otherContext.close();
  assert.deepEqual(errors, []);
  const result = {
    build: "passed",
    staticRouting: "passed",
    authenticatedBrowser: "passed",
    browserDemoIsolationAndPersistence: "passed",
    processRestartPersistence: "passed",
    independentMemberSessions: "passed",
    consistentBackupAndIndependentRestore: "passed",
    documentAndBundleResponses: "passed",
    environment:
      "local compiled HTTP server; no live deployment or real device",
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
