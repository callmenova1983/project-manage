import { test, expect, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { CaptureSource } from "../../packages/domain/capture";

let server: ChildProcess;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/file-preview/${name}`, import.meta.url));
const screenshotImage =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const screenshotMaterialId = "9f6b9eec-218d-4eb8-bc93-3d7c3626f010";

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
  await page.getByRole("button", { name: "AI 工作助手", exact: true }).click();
  await expect(page.locator("#global-ai-assistant")).toBeVisible();
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

async function processingOptions(
  dialog: Locator,
  purpose?: "reference" | "extract",
) {
  const selector = dialog.getByRole("combobox", {
    name: "附件用途",
    exact: true,
  });
  if (!(await selector.isVisible()))
    await dialog.locator(".capture-input > details > summary").click();
  if (purpose) await selector.selectOption(purpose);
}

async function pasteFiles(
  input: Locator,
  files: { name: string; mimeType: string; data: string }[],
) {
  await input.evaluate((element, attachments) => {
    const clipboardData = new DataTransfer();
    for (const attachment of attachments) {
      clipboardData.items.add(
        new File(
          [
            Uint8Array.from(atob(attachment.data), (character) =>
              character.charCodeAt(0),
            ),
          ],
          attachment.name,
          { type: attachment.mimeType },
        ),
      );
    }
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, files);
}

async function stubScreenshot(page: Page) {
  await page.route("**/api/capture/materials", (route) =>
    route.fulfill({
      json: {
        id: screenshotMaterialId,
        name: "截图.png",
        kind: "image",
        size: 68,
        text: "",
        imageCount: 1,
        warnings: [],
      },
    }),
  );
  await page.route(
    `**/api/capture/materials/${screenshotMaterialId}/images/0`,
    (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(screenshotImage, "base64"),
      }),
  );
}

async function pauseProposalSubmission(page: Page) {
  const submissions: {
    source: string;
    originalSource: CaptureSource;
    temporaryMaterialIds?: string[];
  }[] = [];
  // Keep the composer and attachments intact so retries exercise source reuse.
  // No proposal or project is written, even to the isolated fixture workspace.
  await page.route("**/api/proposals", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      json: { message: "测试暂停保存，请重试。" },
    });
  });
  return submissions;
}

test("stores XLS, XLSX and PDF as reference files without extracting their contents", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const workbook = unzipSync(await readFile(fixture("costs.xlsx")));
  workbook["xl/media/diagram.svg"] = strToU8(
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Unsupported embedded drawing</text></svg>',
  );
  const attachments = [
    {
      name: "legacy.xls",
      mimeType: "application/vnd.ms-excel",
      bytes: await readFile(fixture("legacy.xls")),
    },
    {
      name: "costs-with-drawing.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: Buffer.from(zipSync(workbook)),
    },
    {
      name: "report.pdf",
      mimeType: "application/pdf",
      bytes: await readFile(fixture("report.pdf")),
    },
  ];
  const responses = attachments.map(({ name }) =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/capture/materials") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().name === name,
    ),
  );
  const dialog = page.locator("#global-ai-assistant");
  const input = dialog.getByRole("textbox", { name: "录入内容", exact: true });
  await pasteFiles(
    input,
    attachments.map(({ name, mimeType, bytes }) => ({
      name,
      mimeType,
      data: bytes.toString("base64"),
    })),
  );
  for (const [index, response] of (await Promise.all(responses)).entries()) {
    expect(response.status()).toBe(200);
    const material = await response.json();
    expect(material.name).toBe(attachments[index]!.name);
    expect(material.kind).toBe("file");
    expect(material.referenceOnly).toBe(true);
    expect(material.text).toBe("");
    const attachment = dialog.locator(".capture-material").filter({
      has: page.getByRole("link", { name: material.name, exact: true }),
    });
    await expect(attachment).toBeVisible();
    // Verify the actual stored attachment, not just a successful filename chip.
    const downloaded = await page.evaluate(async (id) => {
      const response = await fetch(`/api/capture/materials/${id}`);
      return {
        status: response.status,
        data: btoa(
          String.fromCharCode(...new Uint8Array(await response.arrayBuffer())),
        ),
      };
    }, material.id);
    expect(downloaded.status).toBe(200);
    expect(downloaded.data).toBe(attachments[index]!.bytes.toString("base64"));
  }
  await expect(dialog.locator(".capture-material")).toHaveCount(3);
  await processingOptions(dialog, "reference");
  await processingOptions(dialog);
  await expect(dialog.getByRole("combobox", { name: "附件用途" })).toHaveValue(
    "reference",
  );
  await dialog
    .getByRole("combobox", { name: "归档项目" })
    .selectOption({ index: 1 });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.locator(".capture-submit-actions button[type=submit]"),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("capture-pasted-xls-xlsx-pdf.png"),
  });
  expect(errors).toEqual([]);
});

test("accepts a Chinese PDF through the attachment file chooser", async ({
  page,
}, testInfo) => {
  const dialog = page.locator("#global-ai-assistant");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "添加附件", exact: true }).click();
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/capture/materials") &&
      response.request().method() === "POST",
  );
  await (await chooser).setFiles(fixture("report-cjk.pdf"));
  const uploaded = await response;
  expect(uploaded.status()).toBe(200);
  const material = await uploaded.json();
  expect(material.kind).toBe("file");
  expect(material.text).toBe("");
  expect(material.referenceOnly).toBe(true);
  await expect(
    dialog.getByRole("link", { name: "report-cjk.pdf", exact: true }),
  ).toBeVisible();
  await processingOptions(dialog, "reference");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "归档项目" })
    .selectOption({ index: 1 });
  await expect(
    dialog.locator(".capture-submit-actions button[type=submit]"),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("capture-pdf-file-chooser.png"),
  });
});

test("archives a document by filename without generating proposals or reading its embedded image", async ({
  page,
}) => {
  const document = unzipSync(await readFile(fixture("contract.docx")));
  document["word/media/logo.png"] = Buffer.from(screenshotImage, "base64");
  let analysisAttempts = 0;
  await page.route("**/api/capture/analyze", (route) => {
    analysisAttempts++;
    return route.fulfill({
      status: 500,
      json: { message: "仅文字模式不应调用图片识别。" },
    });
  });
  const submissions = await pauseProposalSubmission(page);
  const dialog = page.locator("#global-ai-assistant");
  const input = dialog.getByRole("textbox", { name: "录入内容", exact: true });
  const typedText = "请整理附件中的合同约定。";
  await input.fill(typedText);
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith("/api/capture/materials") &&
      result.request().method() === "POST",
  );
  await pasteFiles(input, [
    {
      name: "contract-with-logo.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: Buffer.from(zipSync(document)).toString("base64"),
    },
  ]);
  const uploaded = await response;
  expect(uploaded.status()).toBe(200);
  const material = await uploaded.json();
  expect(material.referenceOnly).toBe(true);
  expect(material.text).toBe("");
  expect(material.imageCount).toBe(0);
  await processingOptions(dialog);
  await expect(dialog.getByRole("combobox", { name: "附件用途" })).toHaveValue(
    "reference",
  );
  await expect(dialog.getByRole("combobox", { name: "识别深度" })).toHaveCount(
    0,
  );
  await dialog
    .getByRole("combobox", { name: "归档项目" })
    .selectOption({ index: 1 });
  await dialog.locator(".capture-submit-actions button[type=submit]").click();
  await expect(dialog.getByText(/已归档 1 份资料/)).toBeVisible();
  expect(submissions).toHaveLength(0);
  expect(analysisAttempts).toBe(0);
  await expect(input).toHaveValue("");
  await expect(dialog.locator(".capture-material")).toHaveCount(0);
});

test("pasted screenshots default to recognition without retaining originals, but text-only depth never sends them", async ({
  page,
}) => {
  await stubScreenshot(page);
  let analysisAttempts = 0;
  await page.route("**/api/capture/analyze", (route) => {
    analysisAttempts++;
    return route.fulfill({
      status: 500,
      json: { message: "仅文字模式不应调用图片识别。" },
    });
  });
  const submissions = await pauseProposalSubmission(page);
  const dialog = page.locator("#global-ai-assistant");
  const input = dialog.getByRole("textbox", { name: "录入内容", exact: true });
  await pasteFiles(input, [
    { name: "截图.png", mimeType: "image/png", data: screenshotImage },
  ]);
  await expect(dialog.locator(".capture-material")).toHaveCount(1);
  await processingOptions(dialog);
  await expect(dialog.getByRole("combobox", { name: "附件用途" })).toHaveValue(
    "extract",
  );
  await expect(
    dialog.getByRole("checkbox", { name: "保留原附件" }),
  ).not.toBeChecked();
  await dialog.getByRole("combobox", { name: "识别深度" }).selectOption("text");
  const submit = dialog.locator(".capture-submit-actions button[type=submit]");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toContainText("当前是“仅文字”");
  await expect(dialog.getByRole("alert")).toContainText("识别图中文字");
  await expect(dialog.getByRole("alert")).toContainText("理解图表");
  expect(analysisAttempts).toBe(0);
  expect(submissions).toHaveLength(0);
  await expect(input).toHaveValue("");
  await expect(dialog.locator(".capture-material")).toHaveCount(1);
  await expect(submit).toBeEnabled();
});

test("reuses an unchanged OCR result and analyzes again only after changing depth", async ({
  page,
}) => {
  await stubScreenshot(page);
  const analyses: (CaptureSource & {
    externalProcessingConfirmed: boolean;
  })[] = [];
  await page.route("**/api/capture/analyze", (route) => {
    const source = route.request().postDataJSON();
    analyses.push(source);
    return route.fulfill({
      json: {
        text:
          source.recognitionDepth === "deep"
            ? "图表分析结果：设备调试完成，验收仍待确认。"
            : "图片文字：设备调试尚待验收。",
        uncertainties: [],
        model: "isolated-test-model",
      },
    });
  });
  const submissions = await pauseProposalSubmission(page);
  const dialog = page.locator("#global-ai-assistant");
  const input = dialog.getByRole("textbox", { name: "录入内容", exact: true });
  await input.fill("请整理截图中的事项。");
  await pasteFiles(input, [
    { name: "截图.png", mimeType: "image/png", data: screenshotImage },
  ]);
  await expect(dialog.locator(".capture-material")).toHaveCount(1);
  await processingOptions(dialog);
  const depth = dialog.getByRole("combobox", { name: "识别深度" });
  await depth.selectOption("ocr");
  const submit = dialog.locator(".capture-submit-actions button[type=submit]");
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText("测试暂停保存，请重试。");
  expect(analyses).toEqual([
    {
      text: "请整理截图中的事项。",
      materialIds: [screenshotMaterialId],
      recognitionDepth: "ocr",
      externalProcessingConfirmed: true,
    },
  ]);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.source).toBe("图片文字：设备调试尚待验收。");
  expect(submissions[0]!.originalSource.recognitionDepth).toBe("ocr");
  expect(submissions[0]!.originalSource.materialIds).toEqual([]);
  expect(submissions[0]!.temporaryMaterialIds).toEqual([screenshotMaterialId]);

  await submit.click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(dialog.getByRole("alert")).toHaveText("测试暂停保存，请重试。");
  expect(analyses).toHaveLength(1);
  expect(submissions[1]).toEqual(submissions[0]);

  await depth.selectOption("deep");
  await submit.click();
  await expect.poll(() => submissions.length).toBe(3);
  await expect(dialog.getByRole("alert")).toHaveText("测试暂停保存，请重试。");
  expect(analyses).toHaveLength(2);
  expect(analyses[1]!.recognitionDepth).toBe("deep");
  expect(analyses[1]!.materialIds).toEqual([screenshotMaterialId]);
  expect(submissions[2]!.source).toBe(
    "图表分析结果：设备调试完成，验收仍待确认。",
  );
  expect(submissions[2]!.originalSource.recognitionDepth).toBe("deep");
  await expect(input).toHaveValue("请整理截图中的事项。");
  await expect(dialog.locator(".capture-material")).toHaveCount(1);
});

test("shows one localized budget failure and retains the input and image for retry", async ({
  page,
}) => {
  await stubScreenshot(page);
  let attempts = 0;
  await page.route("**/api/capture/analyze", (route) => {
    attempts++;
    return route.fulfill({
      status: 429,
      json: {
        code: "AI_BUDGET_EXPIRED",
        message: "The approved AI attempt budget is exhausted or expired.",
      },
    });
  });
  const dialog = page.locator("#global-ai-assistant");
  const input = dialog.getByRole("textbox", { name: "录入内容", exact: true });
  await input.fill("核对项目截图，内容不要丢失");
  await pasteFiles(input, [
    { name: "截图.png", mimeType: "image/png", data: screenshotImage },
  ]);
  await expect(
    dialog.getByRole("link", { name: "截图.png", exact: true }),
  ).toBeVisible();
  await processingOptions(dialog);
  await dialog.getByRole("combobox", { name: "识别深度" }).selectOption("ocr");
  const submit = dialog.locator(".capture-submit-actions button[type=submit]");
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toContainText("AI 调用授权已过期");
  await expect(dialog.getByRole("alert")).toContainText("输入内容和附件仍保留");
  await expect(dialog.getByRole("alert")).not.toContainText("The approved AI");
  await expect(input).toHaveValue("核对项目截图，内容不要丢失");
  await expect(dialog.locator(".capture-material")).toHaveCount(1);
  await expect(submit).toBeEnabled();
  expect(attempts).toBe(1);
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await expect(input).toHaveValue("核对项目截图，内容不要丢失");
  await expect(dialog.locator(".capture-material")).toHaveCount(1);
});

for (const recover of [false, true])
  test(`separates reference documents from meeting text with recovery=${recover}`, async ({
    page,
  }) => {
    const pane = page.locator("#global-ai-assistant");
    const taskCount = () =>
      page.evaluate(async () => {
        const response = await fetch("/api/workspace");
        if (!response.ok) throw new Error("Cannot read isolated workspace");
        return (await response.json()).tasks.length as number;
      });
    const beforeTasks = await taskCount();
    const input = pane.getByRole("textbox", { name: "录入内容", exact: true });
    let archiveRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/capture/archive")
        archiveRequests++;
    });
    if (recover)
      await page.route(
        "**/api/proposals",
        async (route) => {
          await route.fulfill({
            status: 503,
            json: { message: "测试记录处理失败，请重试" },
          });
        },
        { times: 1 },
      );
    await pasteFiles(input, [
      {
        name: "Atlas Customer Portal报价方案.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: (await readFile(fixture("contract.docx"))).toString("base64"),
      },
      {
        name: "会议记录.txt",
        mimeType: "text/plain",
        data: Buffer.from(
          "Atlas Customer Portal：需核对现场验收设备。",
        ).toString("base64"),
      },
    ]);
    await expect(pane).toContainText("将归档 1 份资料，并识别 1 份记录");
    await expect(pane).toContainText("归到 Atlas Customer Portal");
    await pane.locator(".capture-submit-actions button[type=submit]").click();
    await expect(pane).toContainText("已归档 1 份资料");
    if (recover) {
      await expect(pane).toContainText("测试记录处理失败，请重试");
      await page.reload();
      await expect(pane).toContainText("已归档 1 份资料");
      await pane.locator(".capture-submit-actions button[type=submit]").click();
    }
    await expect(pane).toContainText("已完成：新增 1 项任务");
    await expect(
      pane.getByRole("region", { name: "处理明细", exact: true }),
    ).toContainText("核对现场验收设备");
    await expect(
      pane.getByRole("region", { name: "待确认项目", exact: true }),
    ).toHaveCount(0);
    await expect(pane.locator(".capture-material")).toHaveCount(0);
    await page.reload();
    await expect(pane).toContainText("已完成：新增 1 项任务");
    await expect(pane).toContainText("已归档 1 份资料");
    expect(archiveRequests).toBe(1);
    expect(await taskCount()).toBe(beforeTasks + 1);
  });
