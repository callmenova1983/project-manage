import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const language of ["en", "zh-CN"] as const)
  for (const theme of ["dark", "light"] as const)
    for (const width of [1536, 375]) {
      test(`preferences ${language} ${theme} ${width}: accessible graphics, persistence and original content`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 1536 ? 1024 : 844,
        });
        const errors: string[] = [],
          apiRequests: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/"))
            apiRequests.push(request.url());
        });
        await page.goto("/demo/projects");
        await expect(
          page.getByRole("heading", { name: "Projects 20", exact: true }),
        ).toBeVisible();
        await page.locator(".language-select").selectOption(language);
        const zh = language === "zh-CN";
        if (theme === "light")
          await page
            .getByRole("button", {
              name: zh ? "切换到浅色主题" : "Switch to light theme",
              exact: true,
            })
            .click();
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(
          page.getByRole("heading", {
            name: zh ? "项目 20" : "Projects 20",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", {
            name: "Atlas Customer Portal",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("group", {
            name: zh ? "项目阶段" : "Project stages",
            exact: true,
          }),
        ).toBeVisible();
        await noOverflow(page);
        const a11y = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(a11y.violations).toEqual([]);
        mkdirSync("artifacts", { recursive: true });
        await page.screenshot({
          path: `artifacts/portfolio-${language}-${theme}-${width}.png`,
        });
        const stage = page
          .getByRole("group", {
            name: zh ? "项目阶段" : "Project stages",
            exact: true,
          })
          .getByRole("button")
          .first();
        await stage.click();
        await expect(stage).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(".project-record")).toHaveCount(4);
        await stage.click();
        await expect(page.locator(".project-record")).toHaveCount(20);
        await page
          .getByRole("button", {
            name: zh ? "本周变化与近期事项" : "Changes & next work",
            exact: true,
          })
          .click();
        await expect(
          page.getByText(
            zh ? "本周暂无已保存的变更" : "No saved changes this week",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(page.locator(".next-work")).toBeVisible();
        await noOverflow(page);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(
          page.getByRole("heading", {
            name: zh ? "项目 20" : "Projects 20",
            exact: true,
          }),
        ).toBeVisible();
        expect(errors).toEqual([]);
        expect(apiRequests).toEqual([]);
      });
    }

test("explicit theme and language preferences are independent of system changes", async ({
  page,
}) => {
  await page.goto("/demo/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator(".language-select").selectOption("zh-CN");
  await page
    .getByRole("button", { name: "切换到深色主题", exact: true })
    .click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("real local changes become weekly history, completion is auditable, task focus survives navigation", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Original source 保留");
  await page.getByLabel("Today", { exact: true }).check();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByLabel("Status for Original source 保留").selectOption("done");
  await page
    .getByRole("button", { name: "Changes & next work", exact: true })
    .click();
  await expect(page.locator(".weekly-changes .change-metrics")).toContainText(
    "2",
  );
  await expect(page.locator(".completed-metric strong")).toHaveText("1");
  await expect(page.locator(".change-timeline")).toContainText(
    "Task marked done",
  );
  await page
    .locator(".change-timeline")
    .getByRole("link", { name: "Original source 保留", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/demo\/activity\?project=project-1#activity-/);
  await expect(page.locator(".activity-event").first()).toContainText(
    "Original source 保留",
  );
  await page.goto("/demo/tasks?scope=week&focus=open&project=project-1");
  await expect(page.getByLabel("Filter task project")).toHaveValue("project-1");
  await expect(page.locator(".task-row")).toHaveCount(6);
  await page
    .getByRole("group", { name: "Filter task status" })
    .getByRole("button", { name: /^Done/ })
    .click();
  await expect(page).toHaveURL(/status=done/);
  await expect(page.locator(".task-row")).toHaveCount(3);
  await page.goBack();
  await expect(page).toHaveURL(/focus=open/);
  await expect(page.locator(".task-row")).toHaveCount(6);
});
