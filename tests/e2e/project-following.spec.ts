import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { scenarioLogin } from "./scenario-login";
for (const width of [1536, 390])
  test(`following combines with filters, persists and keeps all projects editable at ${width}px`, async ({
    page,
  }) => {
    const zh = width === 390,
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: zh ? 844 : 1024 });
    if (zh)
      await page.addInitScript(() => {
        localStorage.setItem("project-manage-locale", "zh-CN");
        localStorage.setItem("project-manage-theme", "light");
      });
    await page.goto("/demo/projects");
    await expect(page.locator(".project-row")).toHaveCount(20);
    const before = await page.evaluate(() =>
      localStorage.getItem("project-manage-demo-v1"),
    );
    for (const name of ["Atlas Customer Portal", "Meridian Workspace"]) {
      const button = page.getByRole("button", {
        name: (zh ? "关注 " : "Follow ") + name,
        exact: true,
      });
      await button.focus();
      await page.keyboard.press("Space");
    }
    const following = page.locator(".following-filter");
    await expect(following).toContainText("2");
    await following.click();
    await expect(page.locator(".project-row")).toHaveCount(2);
    const search = page.getByLabel(zh ? "搜索项目" : "Search projects", {
      exact: true,
    });
    await search.fill("Atlas");
    await expect(page.locator(".project-row")).toHaveCount(1);
    await search.fill("no matches");
    await expect(page.locator(".project-row")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: zh ? "清除筛选" : "Clear filters",
        exact: true,
      })
      .click();
    await expect(page.locator(".project-row")).toHaveCount(20);
    await page.reload();
    await expect(following).toContainText("2");
    await following.click();
    await expect(page.locator(".project-row")).toHaveCount(2);
    mkdirSync("artifacts/personal-work", { recursive: true });
    await page.screenshot({
      path: `artifacts/personal-work/following-${width}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "Atlas Customer Portal", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: (zh ? "取消关注 " : "Unfollow ") + "Atlas Customer Portal",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: zh ? "编辑项目" : "Edit project",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("form", {
        name: zh ? "项目编辑器" : "Project editor",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
      .click();
    await page.goto("/demo/projects");
    await expect(following).toContainText("1");
    const after = await page.evaluate(() =>
      localStorage.getItem("project-manage-demo-v1"),
    );
    expect(after).toEqual(before);
    expect(errors).toEqual([]);
  });
test("following is isolated when switching accounts and workspace data stays shared", async ({
  page,
}) => {
  test.setTimeout(60000);
  await scenarioLogin(page, "data/e2e-login.json");
  await page.goto("/projects");
  const row = page.locator("[data-project-record]").first();
  await expect(row).toBeVisible();
  const name = await row.locator(".project-name a").innerText();
  await row
    .getByRole("button", { name: `Follow ${name}`, exact: true })
    .click();
  await expect(page.locator(".following-filter")).toContainText("1");
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await scenarioLogin(page, "data/e2e-admin-login.json");
  await page.goto("/projects");
  await expect(page.locator(".following-filter")).toContainText("0");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.locator(".following-filter").click();
  await expect(page.locator(".project-row")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await scenarioLogin(page, "data/e2e-login.json");
  await page.goto("/projects");
  await expect(page.locator(".following-filter")).toContainText("1");
});
test("storage failure leaves the follow selection unchanged and reports recovery", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("project-manage-following-v1:"))
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/demo/projects");
  await page
    .getByRole("button", { name: "Follow Atlas Customer Portal", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("selection is unchanged");
  await expect(
    page.getByRole("button", {
      name: "Follow Atlas Customer Portal",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".project-row")).toHaveCount(20);
});
