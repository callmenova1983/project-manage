import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

let server: ChildProcess, address: string;
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  server = spawn(
    process.execPath,
    ["--import", "tsx", "tests/fixtures/ai-access-server.mjs"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, PM_AI_ACCESS_TEST_ORIGIN: origin },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const connection = await new Promise<{ address: string; cookie: string }>(
    (resolve, reject) => {
      let output = "",
        errors = "";
      server.stderr?.on("data", (chunk) => {
        errors += String(chunk);
      });
      server.on("error", reject);
      server.on("exit", () =>
        reject(new Error(errors || "AI access test API stopped")),
      );
      server.stdout?.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("\n")) {
          try {
            resolve(JSON.parse(output.trim()));
          } catch (e) {
            reject(e);
          }
        }
      });
    },
  );
  address = connection.address;
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const response = await fetch(address + url.pathname + url.search, {
      method: request.method(),
      headers: { ...request.headers(), cookie: connection.cookie, origin },
      ...(request.postData() ? { body: request.postData()! } : {}),
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
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

test("copies usable instructions, discovers all projects, regenerates and revokes personal access", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects");
  await expect(page.locator('.horizontal-nav a[href="/activity"]')).toHaveText(
    "活动",
  );
  await expect(
    page.locator('.horizontal-nav a[href="/project-map"]'),
  ).toHaveText("地图");
  await expect(page.locator(".topbar .ai-access-launch")).toHaveCount(0);
  await page.locator(".assistant-launch").click();
  await expect(
    page.locator(".assistant-header .ai-access-launch"),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-entry.png") });
  await page.getByRole("button", { name: "AI 接入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 接入", exact: true });
  await expect(
    dialog.getByRole("button", { name: "生成并复制接入指令", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: false,
  });
  await dialog
    .getByRole("button", { name: "生成并复制接入指令", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("接入说明已复制");
  const copied = await page.evaluate(async () => (await navigator.clipboard.readText()));
  expect(copied).toContain(`${new URL(baseURL!).origin}/api/ai-access/context`);
  expect(copied).not.toContain("项目 ID：");
  const token = /Authorization: Bearer (pm_ai_[A-Za-z0-9_-]+)/.exec(
    copied,
  )![1]!;
  const initialize = await fetch(`${address}/api/ai-access/context`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(initialize.status).toBe(200);
  const state = await initialize.json();
  expect(state.actor.name).toBe("AI Access Tester");
  expect(state.projectCount).toBeGreaterThan(1);
  expect(state.projects).toHaveLength(state.projectCount);
  const docs = await fetch(`${address}/api/ai-access/docs`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(docs.status).toBe(200);
  expect((await docs.json()).endpoints.length).toBeGreaterThan(20);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(token);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "AI 接入", exact: true }).click();
  await expect(dialog.locator("textarea")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "重新生成并复制接入指令", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("接入说明已复制");
  const replacement = /Bearer (pm_ai_[A-Za-z0-9_-]+)/.exec(
    await page.evaluate(async () => (await navigator.clipboard.readText())),
  )![1]!;
  expect(replacement).not.toBe(token);
  expect(
    (
      await fetch(`${address}/api/projects`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(401);
  await dialog.getByRole("button", { name: "撤销接入" }).click();
  await expect(dialog.getByRole("status")).toContainText("已撤销");
  expect(
    (
      await fetch(`${address}/api/projects`, {
        headers: { authorization: `Bearer ${replacement}` },
      })
    ).status,
  ).toBe(401);
  expect(errors).toEqual([]);
});

test("mobile entry, clipboard fallback, focus restoration and complete manual instructions", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    document.execCommand = () => false;
  });
  await page.goto("/tasks");
  await page.locator(".assistant-launch").click();
  await expect(
    page.locator(".assistant-header .ai-access-launch span"),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-entry.png") });
  const launch = page.getByRole("button", { name: "AI 接入", exact: true });
  await launch.click();
  const dialog = page.getByRole("dialog", { name: "AI 接入", exact: true });
  await expect(
    dialog.getByRole("button", { name: "生成并复制接入指令", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "生成并复制接入指令", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("浏览器无法自动复制");
  const textarea = dialog.getByRole("textbox", {
    name: "接入说明",
    exact: true,
  });
  await expect(textarea).toHaveValue(/Authorization: Bearer pm_ai_/);
  expect(
    await textarea.evaluate(
      (node: HTMLTextAreaElement) =>
        node.selectionStart === 0 && node.selectionEnd === node.value.length,
    ),
  ).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "复制接入说明", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(launch).toBeFocused();
  await expect(page.locator("#global-ai-assistant")).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.getElementById("ai-access-instructions"),
    ),
  ).toBeNull();
});
