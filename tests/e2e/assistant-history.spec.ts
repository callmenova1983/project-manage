import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  projectListRows,
  projectListSource,
} from "../fixtures/assistant-project-list";
import type { AssistantTurnInput } from "../../packages/domain/assistant-plan";

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
    page.once("dialog", async (dialog) => (await dialog.dismiss()));
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
  page.once("dialog", async (dialog) => (await dialog.accept()));
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
  page.once("dialog", async (dialog) => (await dialog.accept()));
  await clear.click();
  await expect(pane).toContainText("请先恢复云端对话，再清空聊天记录");
  await expect(pane).toContainText(marker);
  expect((await (await api("/assistant/session")).json()).state).toEqual(newer);
  await expect(clear).toBeDisabled();
  await pane.getByRole("button", { name: "恢复云端对话", exact: true }).click();
  await expect(pane).toContainText("another-device-newer-history");
  await expect(clear).toBeEnabled();
  page.once("dialog", async (dialog) => (await dialog.accept()));
  await clear.click();
  await expect(pane.getByText("把事情交给我", { exact: true })).toBeVisible();
  expect((await (await api("/assistant/session")).json()).state).toEqual({});
});

test("continues a pasted project list after clarification, reload and a failed attempt without losing or replaying it", async ({
  page,
}, testInfo) => {
  const supplied = process.env.PM_ASSISTANT_CASE_FILE
    ? (JSON.parse(readFileSync(process.env.PM_ASSISTANT_CASE_FILE, "utf8")) as {
        source: string;
        rows: typeof projectListRows;
      })
    : { source: projectListSource, rows: projectListRows };
  // The raw list must survive independently from the 2,000-character chat summary.
  const source = "测试清单说明。".repeat(300) + "\n" + supplied.source;
  const original = await (await api("/workspace")).json();
  const session = await (await api("/assistant/session")).json();
  expect(
    (
      await api("/assistant/session", "PUT", {
        version: session.version,
        state: {},
      })
    ).status,
  ).toBe(200);
  const requests: AssistantTurnInput[] = [];
  await page.route("**/api/assistant/interpret", async (route) => {
    const payload = route.request().postDataJSON() as AssistantTurnInput;
    requests.push(payload);
    if (requests.length === 3) {
      await route.fulfill({
        status: 502,
        json: {
          code: "AI_INVALID_OUTPUT",
          message: "Synthetic invalid model result",
        },
      });
      return;
    }
    const plan =
      requests.length <= 2
        ? { kind: "clarify", question: "请确认这份清单要做什么操作？" }
        : requests.length === 4
          ? {
              kind: "project",
              rows: supplied.rows.map((row) => ({
                projectId: null,
                name: row.name,
                client: row.client,
                quote: `${row.number}\t${row.name}\t${row.client}`,
              })),
            }
          : {
              kind: "query",
              entity: "projects",
              projectIds: [],
              status: "all",
              range: "all",
            };
    await route.fulfill({
      json: {
        model: "synthetic",
        plan,
        ...(requests.length > 4
          ? { answer: { handled: true, text: "查询完成", links: [] } }
          : {}),
      },
    });
  });
  await page.goto("/projects");
  await page.locator(".assistant-launch").click();
  const pane = page.locator("#global-ai-assistant");
  const composer = pane.getByRole("textbox", { name: "录入内容", exact: true });
  const send = pane.getByRole("button", { name: "发送", exact: true });
  await composer.fill(source);
  await send.click();
  await expect(pane).toContainText("请确认这份清单要做什么操作？");
  expect(await (await api("/workspace")).json()).toEqual(original);
  await expect
    .poll(
      async () =>
        (await (await api("/assistant/session")).json()).state.clarification
          ?.source,
    )
    .toBe(source);
  const supplement = "保留客户名称，暂时不建任务";
  await composer.fill(supplement);
  await send.click();
  const fullDraft = source + "\n\n" + supplement;
  await expect
    .poll(
      async () =>
        (await (await api("/assistant/session")).json()).state.clarification
          ?.source,
    )
    .toBe(fullDraft);
  expect(requests[1]!.draft).toBe(source);
  await page.reload();
  await expect(pane).toContainText("请确认这份清单要做什么操作？");
  await composer.fill("批量新建项目建档");
  await send.click();
  await expect(pane.getByRole("alert")).toContainText("AI 整理结果的格式异常");
  await expect(composer).toHaveValue("批量新建项目建档");
  expect(requests[2]!.draft).toBe(fullDraft);
  expect(await (await api("/workspace")).json()).toEqual(original);
  await send.click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]!.draft).toBe(fullDraft);
  await expect
    .poll(async () => (await (await api("/workspace")).json()).projects.length)
    .toBe(original.projects.length + 11);
  const saved = await (await api("/workspace")).json();
  expect(saved.tasks).toEqual(original.tasks);
  for (const row of supplied.rows) {
    const matches = saved.projects.filter(
      (project: { name: string }) => project.name === row.name,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].client).toBe(row.client);
  }
  const receipt = await (await api("/intakes")).json();
  expect(receipt[0].source.originalSource.text).toContain(supplied.source);
  await expect
    .poll(
      async () =>
        (await (await api("/assistant/session")).json()).state.clarification,
    )
    .toBeNull();
  await composer.fill("现在有哪些项目");
  await send.click();
  await expect(pane).toContainText("查询完成");
  expect(requests[4]!.draft).toBeUndefined();
  expect((await (await api("/workspace")).json()).projects).toHaveLength(
    original.projects.length + 11,
  );
  await page.screenshot({
    path: testInfo.outputPath("clarified-project-list.png"),
  });
});
