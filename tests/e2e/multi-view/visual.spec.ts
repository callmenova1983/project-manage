import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetWorkspace } from "./support";

for (const language of ["en", "zh"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [1536, 1024, 768, 390, 375]) {
      test(`task views and project/people overview ${language} ${theme} ${width}`, async ({
        page,
      }, info) => {
        test.setTimeout(120000);
        await resetWorkspace(page, { language, theme });
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/tasks?scope=all&project=project-1&view=list");
        const names =
          language === "en"
            ? ["List view", "Board view", "Task calendar", "Gantt view"]
            : ["列表", "看板", "日历", "甘特图"];
        const assertScreen = async (name: string) => {
          await expect
            .poll(
              async () =>
                page.evaluate(() => ({
                  width: document.documentElement.clientWidth,
                  scroll: document.documentElement.scrollWidth,
                })),
              {
                message: `${name} must use the exact CSS viewport without page overflow`,
              },
            )
            .toEqual({ width, scroll: width });
          const result = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          expect(
            result.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              nodes: violation.nodes.map((node) => ({
                target: node.target,
                message: node.failureSummary,
              })),
            })),
            `${name} accessibility`,
          ).toEqual([]);
          await page.screenshot({ path: info.outputPath(`${name}.png`) });
        };
        for (const [index, name] of names.entries()) {
          await test.step(name, async () => {
            await page
              .getByRole("group", {
                name: language === "en" ? "Task view" : "任务视图",
                exact: true,
              })
              .getByRole("button", { name, exact: true })
              .click();
            await expect(
              page.locator(
                [
                  ".task-collection-list",
                  ".task-board",
                  ".task-calendar",
                  ".gantt",
                ][index]!,
              ),
            ).toBeVisible();
            await assertScreen(`task-${index}`);
          });
        }
        await page.goto("/projects/project-1");
        await page
          .getByRole("button", {
            name: language === "en" ? "Project details" : "项目详情",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: language === "en" ? "Task summary" : "任务摘要",
            exact: true,
          }),
        ).toBeVisible();
        await assertScreen("project-overview");
        await page
          .getByRole("button", {
            name: language === "en" ? "Close Project details" : "关闭 项目详情",
            exact: true,
          })
          .click();
        await page.goto("/directory?tab=work&scope=all&project=project-1");
        await expect(
          page.getByRole("heading", {
            name: language === "en" ? "People planning" : "人员安排",
            exact: true,
          }),
        ).toBeVisible();
        await assertScreen("people");
        expect(errors).toEqual([]);
      });
    }
