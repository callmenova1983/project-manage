import { test, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4187";
test.beforeEach(async ({ context, page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
  });
  const login = await context.request.post(`${origin}/api/auth/login`, {
    headers: { origin },
    data: {
      email: "wecom-admin@example.test",
      password: "wecom-test-password-only",
    },
  });
  expect(login.ok()).toBeTruthy();
  const { csrf } = await login.json();
  const state = await (
    await context.request.get(`${origin}/api/admin/wecom-login`)
  ).json();
  const save = await context.request.put(`${origin}/api/admin/wecom-login`, {
    headers: { origin, "x-csrf-token": csrf },
    data: {
      version: state.version,
      enabled: true,
      corpId: "corp-test",
      agentId: "1000001",
      secret: "synthetic-secret",
      autoProvision: false,
    },
  });
  expect(save.ok()).toBeTruthy();
});
test("admin edits configuration and checks saved credentials", async ({
  page,
}) => {
  await page.goto("/admin?tab=wecom-login");
  await expect(
    page.getByRole("heading", { name: "企业微信免登", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("应用 Secret")).toHaveValue("");
  await expect(page.getByLabel("工作台应用入口", { exact: true })).toHaveValue(
    `${origin}/api/auth/wecom/start?workspace=wecom-test`,
  );
  await page.getByRole("button", { name: "检查已保存的应用凭据" }).click();
  await expect(page.getByRole("status")).toContainText("验证通过");
  await page.getByLabel("首次访问自动开通普通成员").check();
  await page.getByRole("button", { name: "保存免登设置" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.screenshot({
    path: "artifacts/wecom-login-admin.png",
    fullPage: true,
  });
});
test.describe("enterprise browser", () => {
  test.use({
    userAgent: "Mozilla/5.0 wxwork/4.1.0",
    viewport: { width: 390, height: 844 },
  });
  test("automatically signs in and preserves the task link", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    // Simulate enterprise authorization locally. Playwright does not route each
    // hop in a redirect chain, so intercept the start response before it leaves.
    await page.route("**/api/auth/wecom/start?**", async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const authorize = new URL(response.headers().location!);
      const callback = new URL(authorize.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", authorize.searchParams.get("state")!);
      callback.searchParams.set("code", "synthetic-code");
      await route.fulfill({
        response,
        headers: { ...response.headers(), location: callback.href },
      });
    });
    await page.goto("/tasks?source=notification");
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await context.request.get(
          `${origin}/api/auth/session`,
        );
        return response.ok() ? (await response.json()).actor.email : "";
      })
      .toBe("wecom-member@example.test");
    await expect(page).toHaveURL(/\/tasks\?source=notification$/);
    await page.screenshot({
      path: "artifacts/wecom-login-mobile.png",
      fullPage: true,
    });
  });
  test("keeps password login and retry after failure without looping", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    let redirects = 0;
    await page.route("https://open.weixin.qq.com/**", async (route) => {
      redirects++;
      await route.abort();
    });
    await page.goto("/tasks?wecom_error=unlinked");
    await expect(page.getByRole("alert")).toContainText("尚未关联系统账号");
    await expect(
      page.getByRole("button", { name: "通过企业微信登录 / 重试" }),
    ).toBeVisible();
    await expect(
      page.locator('input[autocomplete="current-password"]'),
    ).toBeVisible();
    expect(redirects).toBe(0);
  });
});
test("ordinary browser retains password login", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/tasks");
  await expect(
    page.locator('input[autocomplete="current-password"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "通过企业微信登录 / 重试" }),
  ).toHaveCount(0);
});
