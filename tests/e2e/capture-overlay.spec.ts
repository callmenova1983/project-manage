import { test, expect, type Locator, type Page } from "@playwright/test";

// The assistant is now global and persistent, not a route-owned modal.
// Keep mobile viewport checks separate from real-device microphone acceptance.
const viewports = [
  { width: 1440, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 390, height: 440, mobile: true },
];
const panel = (page: Page) => page.locator("#global-ai-assistant");
const input = (pane: Locator) =>
  pane.getByRole("textbox", { name: "录入内容", exact: true });
const send = (pane: Locator) =>
  pane.locator(".capture-submit-actions button[type=submit]");
async function fitsViewport(page: Page) {
  const pane = panel(page);
  expect(
    await pane.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.left >= -1 &&
        box.right <= innerWidth + 1 &&
        box.top >= -1 &&
        box.bottom <= innerHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      );
    }),
  ).toBe(true);
  await expect(send(pane)).toBeInViewport();
  await expect(
    pane.getByRole("button", { name: "收起 AI 助手", exact: true }),
  ).toBeInViewport();
}
async function draftSnapshot(page: Page) {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("project-manage-demo-v1")!);
    return {
      projects: state.projects.length,
      tasks: state.tasks.length,
      activities: state.activities.length,
    };
  });
}
for (const viewport of viewports) {
  test.describe(`Global AI sidebar ${viewport.width}x${viewport.height}`, () => {
    test.use({
      viewport,
      hasTouch: viewport.mobile,
      isMobile: viewport.mobile,
    });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("project-manage-locale", "zh-CN");
        localStorage.setItem("project-manage-theme", "light");
      });
      await page.goto("/demo/projects");
      await expect(page.locator(".project-record").first()).toBeVisible();
    });
    test("retains unsent draft across collapse, navigation and reload without business writes", async ({
      page,
    }, info) => {
      const initial = await draftSnapshot(page);
      const trigger = page.getByRole("button", {
        name: "AI 工作助手",
        exact: true,
      });
      const pane = panel(page);
      const close = pane.getByRole("button", {
        name: "收起 AI 助手",
        exact: true,
      });
      const text = "未发送草稿：现场核对设备\n第二行保留。";
      await trigger.click();
      await expect(pane).toBeVisible();
      await expect(page).toHaveURL(/\/demo\/projects$/);
      await input(pane).fill(text);
      await fitsViewport(page);
      if (viewport.mobile) {
        expect(
          await input(pane).evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
          ),
        ).toBeGreaterThanOrEqual(16);
        await close.focus();
        for (const key of ["Tab", "Shift+Tab"]) {
          for (let i = 0; i < 8; i++) {
            await page.keyboard.press(key);
            expect(
              await pane.evaluate((element) =>
                element.contains(document.activeElement),
              ),
            ).toBe(true);
          }
        }
      } else {
        await expect(page.locator("#main-content")).not.toHaveAttribute(
          "inert",
          "",
        );
      }
      await close.click();
      await expect(pane).toBeHidden();
      await expect(trigger).toBeFocused();
      // A collapsed assistant does not add a dirty-state route blocker.
      if (viewport.mobile)
        await page
          .getByRole("button", { name: "展开或收起侧栏", exact: true })
          .click();
      await page.getByRole("link", { name: "任务", exact: true }).click();
      await trigger.click();
      await expect(input(pane)).toHaveValue(text);
      await page.reload();
      await expect(input(pane)).toHaveValue(text);
      await fitsViewport(page);
      expect(await draftSnapshot(page)).toEqual(initial);
      await page.screenshot({
        path: info.outputPath("assistant-restored.png"),
      });
    });
    test("creates a complete request once and restores results without replaying it", async ({
      page,
    }, info) => {
      const initial = await draftSnapshot(page);
      await page
        .getByRole("button", { name: "AI 工作助手", exact: true })
        .click();
      const pane = panel(page),
        name = `侧栏验收项目${viewport.height}`;
      await input(pane).fill(
        `项目：${name}；渠道：公司；负责人：Alex Morgan；阶段：实施中；任务：核对现场设备`,
      );
      await send(pane).click();
      await expect(
        pane.getByRole("region", { name: "处理明细", exact: true }),
      ).toContainText("核对现场设备");
      await expect(pane).toContainText("新建 1 个项目，新增 1 项任务");
      const expected = {
        projects: initial.projects + 1,
        tasks: initial.tasks + 1,
      };
      expect(await draftSnapshot(page)).toMatchObject(expected);
      await page.reload();
      await expect(pane).toContainText(name);
      expect(await draftSnapshot(page)).toMatchObject(expected);
      await fitsViewport(page);
      await page.screenshot({ path: info.outputPath("assistant-created.png") });
    });
    test("keeps chat available while clarifying a project and completes it after reload", async ({
      page,
    }) => {
      await page
        .getByRole("button", { name: "AI 工作助手", exact: true })
        .click();
      const pane = panel(page);
      const before = await draftSnapshot(page);
      await input(pane).fill("陌生验收项目：核对设备范围");
      await send(pane).click();
      const reply = pane.getByRole("textbox", { name: "回复", exact: true });
      await expect(reply).toBeVisible();
      await fitsViewport(page);
      expect(await draftSnapshot(page)).toEqual(before);
      await page.reload();
      await expect(reply).toBeVisible();
      await reply.fill("归到 Atlas Customer Portal");
      await send(pane).click();
      await expect(pane.locator(".meeting-message").last()).toContainText(
        "已完成：新增 1 项任务",
      );
      expect(await draftSnapshot(page)).toMatchObject({
        projects: before.projects,
        tasks: before.tasks + 1,
      });
      await fitsViewport(page);
    });

    test("answers real task queries without creating projects or tasks", async ({
      page,
    }) => {
      const initial = await draftSnapshot(page);
      await page
        .getByRole("button", { name: "AI 工作助手", exact: true })
        .click();
      const pane = panel(page);
      await input(pane).fill("本周有哪些未完成任务？");
      await send(pane).click();
      await expect(pane).toContainText("未完成任务");
      await expect(
        pane.locator(".assistant-answer-links a").first(),
      ).toBeVisible();
      expect(await draftSnapshot(page)).toEqual(initial);
      await page.reload();
      await expect(
        pane.locator(".assistant-answer-links a").first(),
      ).toBeVisible();
      expect(await draftSnapshot(page)).toEqual(initial);
    });
  });
}
