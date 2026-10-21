import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

let server: ChildProcess;
let address: string, cookie: string, csrf: string;
let rejectClear = false;
const marker = "history-marker-to-clear";
const draft = "未提交的聊天草稿";
async function api(path: string, method = "GET", body?: unknown) {
  return fetch(address + "/api" + path, {
    method,
    headers: {
      cookie,
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test.beforeEach(async ({ page, baseURL }) => {
  rejectClear = false;
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
        reject(new Error(errors || "Isolated assistant API stopped")),
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
  cookie = connection.cookie;
  csrf = (await (await api("/auth/session")).json()).csrf;
  const seeded = await api("/assistant/session", "PUT", {
    version: 0,
    state: {
      composer: draft,
      messages: [
        { role: "user", text: marker },
        { role: "assistant", text: "已保存项目和任务。" },
      ],
      attachments: {
        materials: [
          {
            id: randomUUID(),
            name: "unsubmitted.txt",
            kind: "file",
            size: 6,
            text: "draft attachment",
            imageCount: 0,
            warnings: [],
          },
        ],
      },
    },
  });
  expect(seeded.status).toBe(200);
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      rejectClear &&
      request.method() === "PUT" &&
      url.pathname === "/api/assistant/session" &&
      Object.keys(request.postDataJSON().state).length === 0
    ) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic unavailable response" }),
      });
      return;
    }
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

for (const mobile of [false, true]) {
  test(`clears synchronized history and unfinished content, preserving business records (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const original = await (await api("/workspace")).json();
    await page.goto("/projects");
    await page.locator(".assistant-launch").click();
    const pane = page.locator("#global-ai-assistant");
    const clear = pane.getByRole("button", {
      name: "清空聊天记录",
      exact: true,
    });
    await expect(pane).toContainText(marker);
    await expect(clear).toBeEnabled();
    await expect(clear).toBeInViewport();
    expect(
      await pane.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("clear-entry.png") });
    page.once("dialog", (dialog) => dialog.dismiss());
    await clear.click();
    await expect(pane).toContainText(marker);
    expect(
      (await (await api("/assistant/session")).json()).state.composer,
    ).toBe(draft);
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(
        "已保存的项目、任务、资料和活动记录会保留",
      );
      await dialog.accept();
    });
    await clear.click();
    await expect(pane).not.toContainText(marker);
    await expect(pane.getByText("把事情交给我", { exact: true })).toBeVisible();
    await expect(
      pane.getByRole("textbox", { name: "录入内容", exact: true }),
    ).toHaveValue("");
    await expect(clear).toBeDisabled();
    expect((await (await api("/assistant/session")).json()).state).toEqual({});
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain(marker);
    expect(await (await api("/workspace")).json()).toEqual(original);
    await page.reload();
    await expect(pane.getByText("把事情交给我", { exact: true })).toBeVisible();
    await expect(pane).not.toContainText(marker);
    await expect(pane).not.toContainText("unsubmitted.txt");
    await expect(clear).toBeDisabled();
    expect(await (await api("/workspace")).json()).toEqual(original);
    await page.screenshot({ path: testInfo.outputPath("cleared.png") });
  });
}

test("keeps the conversation on failure and requires recovery before clearing a newer remote session", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.locator(".assistant-launch").click();
  const pane = page.locator("#global-ai-assistant");
  const clear = pane.getByRole("button", { name: "清空聊天记录", exact: true });
  await expect(clear).toBeEnabled();
  rejectClear = true;
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(pane).toContainText("未能清空聊天记录，原对话仍保留");
  await expect(pane).toContainText(marker);
  await expect(
    pane.getByRole("textbox", { name: "录入内容", exact: true }),
  ).toHaveValue(draft);
  rejectClear = false;
  const current = await (await api("/assistant/session")).json();
  const newer = {
    messages: [{ role: "user", text: "another-device-newer-history" }],
  };
  expect(
    (
      await api("/assistant/session", "PUT", {
        version: current.version,
        state: newer,
      })
    ).status,
  ).toBe(200);
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(pane).toContainText("请先恢复云端对话，再清空聊天记录");
  await expect(pane).toContainText(marker);
  expect((await (await api("/assistant/session")).json()).state).toEqual(newer);
  await expect(clear).toBeDisabled();
  await pane.getByRole("button", { name: "恢复云端对话", exact: true }).click();
  await expect(pane).toContainText("another-device-newer-history");
  await expect(clear).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(pane.getByText("把事情交给我", { exact: true })).toBeVisible();
  expect((await (await api("/assistant/session")).json()).state).toEqual({});
});
