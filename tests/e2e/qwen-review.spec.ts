import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
let server: ChildProcess;
import type { Proposal } from "../../packages/domain/types.js";
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  // Every API request goes to a fresh in-memory workspace, including uploads.
  // The existing frontend and its real API/database are never mutated.
  server = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL("../fixtures/project-files-server.mjs", import.meta.url),
      ),
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, PM_FILE_TEST_ORIGIN: origin },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const { address, cookie } = await new Promise<{
    address: string;
    cookie: string;
  }>((resolve, reject) => {
    let output = "",
      errors = "";
    server.stderr?.on("data", (chunk) => {
      errors += String(chunk);
    });
    server.on("error", reject);
    server.on("exit", () =>
      reject(Error(errors || "Capture test API stopped")),
    );
    server.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("\n")) {
        try {
          resolve(JSON.parse(output.trim()));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const response = await fetch(address + url.pathname + url.search, {
      method: request.method(),
      headers: { ...request.headers(), cookie, origin },
      ...(request.postData() ? { body: request.postData()! } : {}),
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await page.goto("/projects");
});

test.afterEach(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>((resolve) =>
      server.once("exit", () => resolve()),
    );
    server.kill("SIGTERM");
    await stopped;
  }
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/ai/capabilities", async (route) =>
    (await route.fulfill({
      json: {
        enabled: true,
        provider: "qwen",
        model: "qwen3.6-35b-a3b",
        region: "cn-beijing",
        connectionVerified: false,
        remainingAttempts: 3,
      },
    })),
  );
});
test("configured AI records unambiguous progress with one click and no replacement form", async ({
  page,
}) => {
  const project = await page.evaluate(
    async () => (await (await fetch("/api/workspace")).json()).projects[0],
  );
  const source = "Atlas: synthetic acceptance complete";
  let sent = 0,
    applied = 0;
  const proposal: Proposal = {
    id: "synthetic-qwen-proposal",
    source,
    sourceVersion: 1,
    status: "draft",
    createdAt: new Date().toISOString(),
    generator: {
      provider: "qwen",
      model: "qwen3.6-35b-a3b",
      region: "cn-beijing",
      promptVersion: 1,
    },
    suggestions: [
      {
        id: "synthetic-item",
        sourceLine: 1,
        sourceText: source,
        title: "Synthetic acceptance complete",
        candidates: [
          { projectId: project.id, reason: "Synthetic model candidate" },
        ],
        selectedProjectId: "",
        action: "update",
        status: "done",
        confirmed: false,
        overwriteConfirmed: false,
      },
    ],
  };
  await page.route("**/api/assistant/interpret", async (route) => {
    sent++;
    expect(route.request().postDataJSON()).toMatchObject({
      source,
      externalProcessingConfirmed: true,
      originalSource: {
        text: source,
        materialIds: [],
        recognitionDepth: "text",
      },
    });
    await route.fulfill({
      json: {
        plan: {
          kind: "work",
          items: [
            {
              quote: source,
              title: proposal.suggestions[0]!.title,
              projectIds: [project.id],
              action: "update",
              status: "done",
            },
          ],
        },
        model: "qwen3.8-max",
        proposal,
      },
    });
  });
  await page.route(
    "**/api/proposals/synthetic-qwen-proposal/apply",
    async (route) => {
      applied++;
      expect(route.request().postDataJSON()).toMatchObject({
        partial: true,
        updateMode: "append",
        suggestions: [
          {
            selectedProjectId: project.id,
            confirmed: true,
            overwriteConfirmed: false,
          },
        ],
      });
      await route.fulfill({
        json: {
          ...proposal,
          status: "applied",
          appliedSuggestionIds: ["synthetic-item"],
        },
      });
    },
  );
  await page.goto("/meetings");
  await page.getByLabel("录入内容", { exact: true }).fill(source);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("已完成：记录 1 条进展。", { exact: true }),
  ).toBeVisible();
  expect(sent).toBe(1);
  expect(applied).toBe(1);
  await expect(page.locator(".meeting-conversation textarea")).toHaveCount(1);
  await expect(
    page.locator(
      ".meeting-conversation input:not([type=file]), .meeting-conversation select, .suggestion-card",
    ),
  ).toHaveCount(0);
});
