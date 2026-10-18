import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

let server: ChildProcess;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/file-preview/${name}`, import.meta.url));
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  server = spawn(
    process.execPath,
    ["--import", "tsx", fixture("../project-files-server.mjs")],
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
      reject(Error(errors || "Preview test API stopped")),
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
  });
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.route(
    process.env.PM_FILE_PREVIEW_PRODUCTION === "1" ? "**/*" : "**/api/**",
    async (route) => {
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
    },
  );
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

test("uploads, persists and renders DOCX, XLSX, PDF and PPTX with no external document services", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (
      req.url().startsWith("http") &&
      new URL(req.url()).origin !== new URL(baseURL!).origin
    )
      external.push(req.url());
  });
  await page.goto("/projects/project-1");
  await page.getByRole("tab", { name: "资料", exact: true }).click();
  const panel = page.locator("#project-files");
  await expect(
    panel.getByRole("button", { name: "上传文件", exact: true }),
  ).toBeEnabled();
  const names = [
    "contract.docx",
    "costs.xlsx",
    "legacy.xls",
    "report.pdf",
    "report-cjk.pdf",
    "delivery.pptx",
  ];
  await panel.getByLabel("选择项目文件").setInputFiles(names.map(fixture));
  await expect(panel.getByText("已保存 6 个文件")).toBeVisible();
  for (const name of names) {
    await panel.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".office-viewer")).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveCount(0, { timeout: 45000 });
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    if (name.endsWith("docx"))
      await expect(dialog).toContainText("Project attachment preview");
    if (name.endsWith("xlsx") || name.endsWith(".xls"))
      await expect(dialog.locator("canvas").first()).toBeVisible();
    if (name.endsWith("pdf"))
      await expect(dialog.locator("canvas").first()).toBeVisible();
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    await page.screenshot({ path: testInfo.outputPath(`preview-${name}.png`) });
    await dialog.getByRole("button", { name: "Close this dialog" }).click();
    await expect(dialog).toBeHidden();
  }
  await page.reload();
  await page.getByRole("tab", { name: "资料", exact: true }).click();
  for (const name of names)
    await expect(
      panel.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await panel
    .getByRole("link", { name: "下载 contract.docx", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("contract.docx");
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("mobile previews escaped text, falls back to download, and keeps the dialog inside the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const prompts: string[] = [];
  page.on("dialog", async (dialog) => {
    prompts.push(dialog.message());
    await dialog.dismiss();
  });
  await page.goto("/projects/project-1");
  await page.getByRole("tab", { name: "资料", exact: true }).click();
  const panel = page.locator("#project-files");
  await expect(
    panel.getByRole("button", { name: "上传文件", exact: true }),
  ).toBeEnabled();
  await panel
    .getByLabel("选择项目文件")
    .setInputFiles([fixture("notes.txt"), fixture("drawing.dwg")]);
  await expect(panel.getByText("已保存 2 个文件")).toBeVisible();
  await panel.getByRole("button", { name: "notes.txt", exact: true }).click();
  const text = page.getByRole("dialog", { name: "notes.txt", exact: true });
  await expect(text.locator("pre")).toContainText("<script>alert(1)</script>");
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  expect(
    await text.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.left >= 0 &&
        box.right <= innerWidth + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("preview-mobile.png") });
  await text.getByRole("button", { name: "Close this dialog" }).click();
  await panel.getByRole("button", { name: "drawing.dwg", exact: true }).click();
  const unsupported = page.getByRole("dialog", {
    name: "drawing.dwg",
    exact: true,
  });
  await expect(unsupported).toContainText("此格式暂不支持在线预览");
  await expect(
    unsupported.getByRole("link", { name: "下载原文件", exact: true }),
  ).toBeVisible();
  expect(prompts).toEqual([]);
});
