import { mkdirSync, writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "./reliability-fixture.mjs";
const f = await fixture(200, 25),
  results = [],
  errors = [];
try {
  const session = await f.session(0),
    storageState = await session.context.storageState();
  const visibleIds = (page) =>
    page
      .locator("[data-project-record]")
      .evaluateAll((rows) =>
        rows.map((row) => row.dataset.projectRecord).sort(),
      );
  for (const language of ["en", "zh-CN"])
    for (const theme of ["dark", "light"])
      for (const width of [1536, 390]) {
        const zh = language === "zh-CN",
          context = await f.browser.newContext({
            baseURL: f.origin,
            storageState,
            viewport: { width, height: width === 390 ? 844 : 1024 },
            colorScheme: theme,
          }),
          page = await context.newPage();
        try {
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text());
          });
          await page.addInitScript(
            ({ language, theme }) => {
              localStorage.setItem("project-manage-locale", language);
              localStorage.setItem("project-manage-theme", theme);
            },
            { language, theme },
          );
          await page.goto("/projects");
          await expect(page.locator(".project-row")).toHaveCount(200);
          await expect(page.locator(".workspace-totals")).toContainText(
            "5,000",
          );
          expect(await visibleIds(page)).toEqual(
            f.projects.map((p) => p.id).sort(),
          );
          const search = page.getByLabel(zh ? "搜索项目" : "Search projects", {
            exact: true,
          });
          await search.fill("Synthetic project 00");
          await expect(page.locator(".project-row")).toHaveCount(9);
          expect(await visibleIds(page)).toEqual(
            f.projects
              .slice(0, 9)
              .map((p) => p.id)
              .sort(),
          );
          const first = f.projects[0];
          await page
            .getByLabel(zh ? "按阶段筛选" : "Filter by stage", { exact: true })
            .selectOption(first.stage);
          await page
            .getByLabel(zh ? "按负责人筛选" : "Filter by owner", {
              exact: true,
            })
            .selectOption(JSON.stringify(["text", first.owner]));
          const combined = f.projects
            .slice(0, 9)
            .filter((p) => p.stage === first.stage && p.owner === first.owner)
            .map((p) => p.id)
            .sort();
          await expect.poll(() => visibleIds(page)).toEqual(combined);
          await search.fill("No matching synthetic project");
          await expect(page.locator(".project-row")).toHaveCount(0);
          const clear = page.getByRole("button", {
            name: zh ? "清除筛选" : "Clear filters",
            exact: true,
          });
          await clear.focus();
          await page.keyboard.press("Enter");
          await expect(page.locator(".project-row")).toHaveCount(200);
          expect(await visibleIds(page)).toEqual(
            f.projects.map((p) => p.id).sort(),
          );
          await page
            .getByLabel(zh ? "项目排序" : "Sort projects", { exact: true })
            .selectOption("name");
          expect(
            await page
              .locator("[data-project-record]")
              .evaluateAll((rows) =>
                rows.map((row) => row.dataset.projectRecord),
              ),
          ).toEqual(f.projects.map((p) => p.id));
          const today = new Date().toISOString().slice(0, 10);
          await page.locator(".scope-switch button").first().click();
          await expect(
            page.locator(".scope-switch button").first(),
          ).toHaveAttribute("aria-pressed", "true");
          await expect(
            page.locator(".scope-switch button").first().locator("span"),
          ).toHaveText(
            new Intl.NumberFormat(language === "en" ? "en-US" : "zh-CN").format(
              f.tasks.filter((task) => task.workDates.includes(today)).length,
            ),
          );
          await page.locator(".scope-switch button").nth(1).click();
          const last = f.projects[199],
            expand = page.getByRole("button", {
              name: zh ? `展开 ${last.name}` : `Expand ${last.name}`,
              exact: true,
            });
          await expand.focus();
          await page.keyboard.press("Enter");
          await expect(
            page.getByLabel(
              zh
                ? `${last.name} 的原始笔记`
                : `Original notes for ${last.name}`,
              { exact: true },
            ),
          ).toBeVisible();
          await page
            .getByRole("button", {
              name: zh ? `收起 ${last.name}` : `Collapse ${last.name}`,
              exact: true,
            })
            .click();
          await expect(expand).toBeFocused();
          const overflow = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          mkdirSync("artifacts/scale-filter", { recursive: true });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `artifacts/scale-filter/${language}-${theme}-${width}.png`,
          });
          expect(
            overflow.page,
            `${language}/${theme}/${width} page overflow`,
          ).toBeLessThanOrEqual(overflow.viewport + 1);
          expect(
            (
              await new AxeBuilder({ page })
                .include(".filterbar")
                .include(".work-scope-bar")
                .include(".project-record:last-child")
                .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
                .analyze()
            ).violations,
          ).toEqual([]);
          results.push({
            language,
            theme,
            width,
            projects: 200,
            leafTasks: 5000,
            exactIds: true,
            combinedFilters: true,
            emptyAndKeyboardReset: true,
            lastRowReachable: true,
            scopedAxe: true,
          });
          console.log(`Scale filter: ${language}/${theme}/${width} passed`);
        } finally {
          await context.close();
        }
      }
  expect(errors).toEqual([]);
  writeFileSync(
    "artifacts/scale-filter.json",
    JSON.stringify(
      { environment: f.environment, results, unexpectedBrowserErrors: errors },
      null,
      2,
    ),
  );
} finally {
  await f.close();
}
