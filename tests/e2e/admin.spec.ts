import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
for (const width of [1536, 375])
  test(`demo administration at ${width}px: user lifecycle, configuration and no API calls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 844 : 1024 });
    const calls: string[] = [],
      errors: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) calls.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/demo/admin");
    await expect(
      page.getByRole("heading", { name: "Workspace users", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Synthetic intake member");
    await page
      .getByLabel("Email", { exact: true })
      .fill("intake-member@example.test");
    await page
      .getByLabel("Use configured initial password", { exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Save user", exact: true }).click();
    const row = page
      .locator(".admin-user")
      .filter({ hasText: "intake-member@example.test" });
    await expect(row).toContainText("Pending activation");
    await row.getByRole("button", { name: "Simulate activation" }).click();
    await expect(row).toContainText("Active");
    await row.getByRole("button", { name: "Edit", exact: false }).click();
    await page.getByLabel("Account status").selectOption("disabled");
    await page.getByRole("button", { name: "Save user", exact: true }).click();
    await expect(row).toContainText("Disabled");
    await page.reload();
    await expect(
      page
        .locator(".admin-user")
        .filter({ hasText: "intake-member@example.test" }),
    ).toContainText("Disabled");
    await page.screenshot({
      path: `artifacts/admin-users-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("tab", { name: "Model settings", exact: true })
      .click();
    await expect(
      page.getByLabel("Allow explicitly confirmed external requests"),
    ).toBeDisabled();
    await page.getByLabel("Timeout (ms)").fill("10000");
    await page
      .getByRole("button", { name: "Save model settings", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("tab", { name: "Model settings", exact: true })
      .click();
    await expect(page.getByLabel("Timeout (ms)")).toHaveValue("10000");
    await page.getByRole("tab", { name: "Call logs", exact: true }).click();
    await expect(page.locator("tbody")).toContainText("Simulated");
    await page.getByLabel("Log type").selectOption("real");
    await expect(page.getByText("No matching model requests")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".admin-tabs button")
        .evaluateAll((buttons) =>
          buttons.every((b) => b.scrollWidth <= b.clientWidth),
        ),
    ).toBe(true);
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
    await page.getByRole("tab", { name: "Users", exact: true }).click();
    await page.screenshot({
      path: `artifacts/admin-users-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `artifacts/admin-${width}.png`,
      fullPage: true,
    });
  });
test("catalog changes become real project classifications; archiving retains references and keyboard tabs work", async ({
  page,
}) => {
  await page.goto("/demo/admin");
  await page
    .getByRole("tab", { name: "Stages & categories", exact: true })
    .click();
  await page.getByRole("button", { name: "Add stage", exact: true }).click();
  let entry = page.locator(".admin-catalog-entry").last();
  await entry.getByLabel("English name").fill("Client review");
  await entry.getByLabel("Chinese name").fill("客户复核");
  await page.getByRole("button", { name: "Save classifications" }).click();
  await expect(
    page.getByRole("button", { name: "Save classifications" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Business categories", exact: true })
    .click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  entry = page.locator(".admin-catalog-entry").last();
  await entry.getByLabel("English name").fill("Customer work");
  await entry.getByLabel("Chinese name").fill("客户项目");
  await page.getByRole("button", { name: "Save classifications" }).click();
  await expect(
    page.getByRole("button", { name: "Save classifications" }),
  ).toBeDisabled();
  await page.goto("/demo/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Configured stage project");
  await page.getByLabel("Client / organization").fill("Synthetic Co");
  await page
    .getByRole("combobox", { name: "Stage", exact: true })
    .selectOption({ label: "Client review" });
  await page.getByLabel("Customer work", { exact: true }).check();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByLabel("Filter by category")
    .selectOption({ label: "Customer work" });
  await expect(page.locator(".project-row")).toHaveCount(1);
  await expect(page.locator(".project-row")).toContainText(
    "Configured stage project",
  );
  await page.goto("/demo/admin");
  await page
    .getByRole("tab", { name: "Stages & categories", exact: true })
    .click();
  const custom = page.locator(".admin-catalog-entry").last();
  await custom.getByLabel("Archived", { exact: true }).check();
  await page.getByRole("button", { name: "Save classifications" }).click();
  await expect(
    page.getByRole("button", { name: "Save classifications" }),
  ).toBeDisabled();
  await page.locator(".language-select").selectOption("zh-CN");
  await page.getByRole("tab", { name: "阶段与分类", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "模型设置", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "模型设置", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "artifacts/admin-model-zh.png",
    fullPage: true,
  });
});
test("ordinary formal member cannot access administration", async ({
  page,
}) => {
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  await page.goto("/admin");
  await page
    .getByLabel("Login name or email", { exact: true })
    .fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Administrator access is required" }),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
});

test("formal admin creates a pending account; recipient activates once and signs in as a member", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const credentials = JSON.parse(
    readFileSync("data/e2e-admin-login.json", "utf8"),
  );
  await page.request.post("/api/auth/login", { data: credentials });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Synthetic recipient");
  await page
    .getByLabel("Email", { exact: true })
    .fill("recipient@example.test");
  await page
    .getByLabel("Use configured initial password", { exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save user", exact: true }).click();
  const row = page
    .locator(".admin-user")
    .filter({ hasText: "recipient@example.test" });
  await row
    .getByRole("button", { name: "Generate activation link", exact: true })
    .click();
  const link = await page.getByLabel("Private activation link").inputValue();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  const recipient = await browser.newContext(),
    p = await recipient.newPage();
  try {
    await p.goto(link);
    await expect(
      p.getByRole("heading", { name: "Activate your account", exact: true }),
    ).toBeVisible();
    await expect.poll(() => new URL(p.url()).hash).toBe("");
    const password = "Synthetic recipient long phrase 2026";
    await p.getByLabel("New password", { exact: true }).fill(password);
    await p
      .getByLabel("Repeat password", { exact: true })
      .fill("different synthetic phrase");
    await p
      .getByRole("button", { name: "Activate account", exact: true })
      .click();
    await expect(p.getByRole("alert")).toContainText("Passwords do not match");
    await p.getByLabel("Repeat password", { exact: true }).fill(password);
    await p
      .getByRole("button", { name: "Activate account", exact: true })
      .click();
    await expect(
      p.getByText("Account activated. Sign in with your new password.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await recipient.cookies()).some((c) => c.name === "pm_session"),
    ).toBe(false);
    await p
      .getByRole("button", { name: "Continue to sign in", exact: true })
      .click();
    await p
      .getByLabel("Login name or email", { exact: true })
      .fill("recipient@example.test");
    await p.getByLabel("Password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "Projects 20", exact: true }),
    ).toBeVisible();
    expect(
      (await (await p.request.get("/api/auth/session")).json()).actor.role,
    ).toBe("member");
    await page.reload();
    await expect(
      page.locator(".admin-user").filter({ hasText: "recipient@example.test" }),
    ).toContainText("Active");
    await page.screenshot({
      path: "artifacts/admin-users-server.png",
      fullPage: true,
    });
  } finally {
    await recipient.close();
  }
});
