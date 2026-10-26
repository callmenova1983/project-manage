import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
const source = "项目：合成恢复项目；任务：记录尚未提交的事项";
const confirmLabel = "I reviewed the selected rows and their target projects";
const errors: string[] = [];
const expectedFaults = new Set<string>();
test.beforeEach(({ page }) => {
  errors.length = 0;
  expectedFaults.clear();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // Browser resource errors are expected for deliberate HTTP fault injection.
    const status = /^Failed to load resource:.*status of (\d+)/.exec(
      m.text(),
    )?.[1];
    const path = new URL(m.location().url || "/", "http://localhost").pathname;
    if (m.type() === "error" && !expectedFaults.has(`${path}:${status}`))
      errors.push(m.text());
  });
  mkdirSync("artifacts/m1-recovery", { recursive: true });
});
test.afterEach(() => expect(errors).toEqual([]));
async function fillReview(page: Page) {
  await page.getByLabel("Notes or pasted table", { exact: true }).fill(source);
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("合成审阅后修改，尚未提交");
}
async function reloadDirty(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
}
for (const width of [1536, 390])
  test(`restore reviewed edits after reload, require confirmation, save once at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    let apiCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/")) apiCalls++;
    });
    await page.goto("/demo/intake");
    await fillReview(page);
    await page.getByLabel(confirmLabel).check();
    await reloadDirty(page);
    await expect(
      page.getByRole("heading", {
        name: "Unsubmitted intake draft",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/m1-recovery/restore-${width}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
      "合成审阅后修改，尚未提交",
    );
    await expect(page.getByLabel(confirmLabel)).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Create confirmed items", exact: true }),
    ).toBeDisabled();
    expect(await page.locator(".intake-history article").count()).toBe(0);
    await page.screenshot({
      path: `artifacts/m1-recovery/review-${width}.png`,
      fullPage: true,
    });
    await page.getByLabel(confirmLabel).check();
    await page
      .getByRole("button", { name: "Create confirmed items", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Created and recorded" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator(".intake-history article")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Restore draft", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(apiCalls).toBe(0);
  });
test("route return preserves source; explicit cancel and recovery discard remove it", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await fillReview(page);
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".page-heading")
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await page.goBack();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "合成审阅后修改，尚未提交",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".intake-confirm")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByLabel("Notes or pasted table", { exact: true }),
  ).toHaveValue("");
  await page.getByLabel("Notes or pasted table", { exact: true }).fill(source);
  await reloadDirty(page);
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByLabel("Notes or pasted table", { exact: true }),
  ).toHaveValue("");
});
test("XLSX selected sheet, original cells, mapping and edits survive refresh", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/intake.xlsx");
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  const title = page.getByLabel("Task title", { exact: true }).first();
  const original = await title.inputValue();
  await title.fill(original + " 已审阅");
  await reloadDirty(page);
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(
    page.getByLabel("Task title", { exact: true }).first(),
  ).toHaveValue(original + " 已审阅");
  await expect(page.getByLabel(confirmLabel)).not.toBeChecked();
});
test("HTML service failure offers retry before sign-in, demo boundary stays clear", async ({
  page,
}) => {
  expectedFaults.add("/api/auth/session:503");
  expectedFaults.add("/api/auth/session:401");
  let broken = true;
  await page.route("**/api/auth/session", (route) =>
    broken
      ? route.fulfill({
          status: 503,
          contentType: "text/html",
          body: "<h1>synthetic private proxy diagnostics</h1>",
        })
      : route.continue(),
  );
  await page.goto("/intake");
  await expect(
    page.getByRole("heading", { name: "Workspace connection interrupted" }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "private proxy diagnostics",
  );
  await page.screenshot({
    path: "artifacts/m1-recovery/connection-1536.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".language-select").selectOption("zh-CN");
  await expect(
    page.getByRole("heading", { name: "工作区连接中断" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/m1-recovery/connection-390-zh.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  broken = false;
  await page.getByRole("button", { name: "重试连接" }).click();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
});
test("unavailable storage explains recovery limits without blocking editing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("project-manage-intake-draft-v1:"))
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/demo/intake");
  await fillReview(page);
  await expect(page.getByRole("alert")).toContainText(
    "Temporary draft storage is unavailable or full",
  );
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "合成审阅后修改，尚未提交",
  );
});
test("a failed formal save preserves edits; retry creates once and logout removes a later draft", async ({
  page,
}) => {
  expectedFaults.add("/api/intakes:503");
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  expect(
    (await page.request.post("/api/auth/login", { data: credentials })).ok(),
  ).toBe(true);
  await page.goto("/intake");
  const beforeCount = (await (await page.request.get("/api/intakes")).json())
    .length;
  await fillReview(page);
  let fail = true;
  await page.route("**/api/intakes", (route) =>
    route.request().method() === "POST" && fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic save unavailable" }),
        })
      : route.continue(),
  );
  await page.getByLabel(confirmLabel).check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic save unavailable",
  );
  await reloadDirty(page);
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "合成审阅后修改，尚未提交",
  );
  fail = false;
  await page.getByLabel(confirmLabel).check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded" }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/intakes")).json()).length).toBe(
    beforeCount + 1,
  );
  await page.reload();
  await expect(
    page.getByLabel("Notes or pasted table", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill("项目：下一份合成草稿");
  await expect(
    page.getByRole("status").filter({ hasText: "Unsubmitted draft kept" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith("project-manage-intake-draft-v1:"),
      ),
    ),
  ).toEqual([]);
});

test("expired session retains a draft for its owner without offering it to another account", async ({
  page,
}) => {
  expectedFaults.add("/api/workspace:401");
  const member = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  const admin = JSON.parse(readFileSync("data/e2e-admin-login.json", "utf8"));
  await page.request.post("/api/auth/login", { data: member });
  await page.goto("/intake");
  await fillReview(page);
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic session expiry" }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.unroute("**/api/workspace");
  await page.getByLabel("Email", { exact: true }).fill(admin.email);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByLabel("Notes or pasted table", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Restore draft", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(member.email);
  await page.getByLabel("Password", { exact: true }).fill(member.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "合成审阅后修改，尚未提交",
  );
  await expect(page.getByLabel(confirmLabel)).not.toBeChecked();
});
