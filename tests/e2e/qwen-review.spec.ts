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
  await page.route("**/api/ai/capabilities", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        provider: "qwen",
        model: "qwen3.6-35b-a3b",
        region: "cn-beijing",
        connectionVerified: false,
        remainingAttempts: 3,
      },
    }),
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
  await page.route("**/api/proposals/qwen", async (route) => {
    sent++;
    expect(route.request().postDataJSON()).toEqual({
      source,
      externalProcessingConfirmed: true,
      originalSource: {
        text: source,
        materialIds: [],
        recognitionDepth: "text",
      },
    });
    await route.fulfill({ json: proposal });
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
test("AI failure preserves source and completes rule-matched items on the same mobile page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/proposals/qwen", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "AI_PROVIDER", message: "Synthetic provider unavailable" },
    }),
  );
  await page.goto("/meetings");
  const source = "Atlas: synthetic fallback review";
  await page.getByLabel("录入内容", { exact: true }).fill(source);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText(
      "纪要原文已保存。AI 整理未完成，本次采用规则整理；项目不明确的事项只提醒，不创建记录。",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("已完成：新增 1 项任务。", { exact: true }),
  ).toBeVisible();
  expect(
    await page.locator(".meeting-message.user p").first().textContent(),
  ).toBe(source);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("restored draft saves all matched items with one click", async ({
  page,
}) => {
  const seeded = await page.evaluate(async () => {
    const workspace = await (await fetch("/api/workspace")).json();
    const session = await (await fetch("/api/auth/session")).json();
    const response = await fetch("/api/proposals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        source: `### ${workspace.projects[0].name}\n- 设备已上线，下周继续检查运行情况。\n### 未命名场地\n- 另一个项目准备调试。`,
      }),
    });
    if (!response.ok) throw Error(await response.text());
    return { workspace, proposal: await response.json() };
  });
  // Simulate a legacy draft with a stale unique candidate and no ambiguity marker.
  const anonymous = seeded.proposal.suggestions.find(
    (item: { sourceText: string }) => item.sourceText.includes("另一个项目"),
  );
  if (!anonymous) throw Error("Missing anonymous fixture item");
  delete anonymous.sourceHeading;
  anonymous.candidates = [
    {
      projectId: seeded.workspace.projects[0].id,
      reason: "Legacy stale match",
    },
  ];
  await page.route("**/api/assistant/session", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        version: 0,
        updatedAt: null,
        state: { proposal: seeded.proposal, messages: [] },
      },
    });
  });
  await page.goto("/meetings");
  await page
    .getByRole("button", { name: "保存 2 条已明确事项", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(async () =>
            (await fetch("/api/workspace")).json(),
          )
        ).tasks.length,
    )
    .toBe(seeded.workspace.tasks.length + 1);
  const after = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  expect(after.projects).toHaveLength(seeded.workspace.projects.length);
  expect(after.projects[0].latestUpdate).toContain("设备已上线");
  await expect(
    page.getByRole("button", { name: "保存 2 条已明确事项", exact: true }),
  ).toHaveCount(0);
});
test("unclear project only reminds and creates no business records", async ({
  page,
}) => {
  await page.route("**/api/proposals/qwen", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "AI_PROVIDER", message: "Synthetic unavailable" },
    }),
  );
  const before = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  await page.goto("/meetings");
  await page
    .getByLabel("录入内容", { exact: true })
    .fill(
      "### 待明确项目\n- 另一个码头项目计划参考 Atlas 同步申报。\n- 未命名场地本周准备设备。 ",
    );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText(
      "有些事项未明确项目，已跳过，仅保留原文提醒；没有为这些事项创建项目、任务或进展。",
      { exact: true },
    ),
  ).toBeVisible();
  const after = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  expect(after.tasks).toEqual(before.tasks);
  expect(after.projects).toEqual(before.projects);
  await expect(
    page.getByRole("button", { name: "填写名称并新建项目", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("录入内容", { exact: true })).toBeVisible();
  const restored = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  expect(restored.tasks).toEqual(before.tasks);
  expect(restored.projects).toEqual(before.projects);
});
test("mixed meeting fallback saves one progress and one task across refresh", async ({
  page,
}) => {
  await page.route("**/api/proposals/qwen", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "AI_PROVIDER", message: "Synthetic provider unavailable" },
    }),
  );
  const before = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  const project = before.projects[0];
  const source = `### ${project.name}\n- 设备已上线，下周继续检查运行情况。`;
  let applied = 0;
  page.on("request", (request) => {
    if (/\/api\/proposals\/[^/]+\/apply$/.test(request.url())) applied++;
  });
  await page.goto("/meetings");
  await page.getByLabel("录入内容", { exact: true }).fill(source);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect
    .poll(async () => {
      const state = await page.evaluate(async () =>
        (await fetch("/api/workspace")).json(),
      );
      return state.tasks.length;
    })
    .toBe(before.tasks.length + 1);
  const after = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  expect(
    after.tasks.filter(
      (task: { id: string }) =>
        !before.tasks.some((old: { id: string }) => old.id === task.id),
    ),
  ).toMatchObject([
    { projectId: project.id, title: "下周继续检查运行情况。", status: "todo" },
  ]);
  expect(
    after.projects.find((item: { id: string }) => item.id === project.id)
      .latestUpdate,
  ).toContain("设备已上线");
  expect(applied).toBe(1);
  await page.reload();
  await expect(page.getByLabel("录入内容", { exact: true })).toBeVisible();
  const reloaded = await page.evaluate(async () =>
    (await fetch("/api/workspace")).json(),
  );
  expect(reloaded.tasks).toEqual(after.tasks);
  expect(reloaded.projects).toEqual(after.projects);
  expect(applied).toBe(1);
});
