import type { Router } from "vue-router";
import { test, expect, type Page } from "@playwright/test";
import type { WorkspaceApi } from "../../apps/web/src/services/contracts";

async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.goto("/demo/projects");
  await expect(page.locator(".project-record").first()).toBeVisible();
  return page.evaluate(async () => {
    const modulePath = "/src/services/local.ts";
    const { createLocalApi } = (await import(modulePath)) as {
      createLocalApi: () => WorkspaceApi;
    };
    const local = createLocalApi();
    if (local.mode !== "local") throw new Error("Demo storage required");
    const project = await local.saveProject({
      name: "项目详情布局回归",
      client: "测试客户",
      channelId: "company",
      description: "这是项目背景，资料页应保留完整内容。",
      stage: "proposal",
      owner: "测试负责人",
      discipline: "Sales",
      latestUpdate: "已完成现场需求确认，正在核对材料要求并准备报价。".repeat(
        5,
      ),
      notes: "会议原始记录需要保留。",
      aliases: ["测试项目"],
    });
    const task = await local.saveTask({
      projectId: project.id,
      parentId: null,
      title: "确认报价范围",
      description: "与客户逐项确认材料和交付边界。",
      status: "todo",
      assignee: "测试负责人",
      dueDate: null,
      workWeek: null,
      workDates: [],
    });
    await local.saveTask({
      projectId: project.id,
      parentId: null,
      title: "完成现场沟通",
      description: "原始任务内容保留",
      status: "done",
      assignee: "",
      dueDate: null,
      workWeek: null,
      workDates: [],
    });
    return { projectId: project.id, taskId: task.id };
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  for (const dialog of await page.locator("dialog:visible").all()) {
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
}
for (const mobile of [false, true]) {
  test.describe(`project detail ${mobile ? "mobile" : "desktop"}`, () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    test("task-first layout, filters, settings, inline edit, creation and history", async ({
      page,
    }, info) => {
      const errors: string[] = [],
        writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", async (route) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
          writes.push(route.request().method() + " " + route.request().url());
          await route.abort();
        } else await route.continue();
      });
      const data = await fixture(page);
      await page.goto(`/demo/projects/${data.projectId}`);
      const rows = page.locator(".project-work-list .task-row");
      await expect(rows).toHaveCount(2);
      await expect(page.getByRole("tab", { name: /任务/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(rows.first()).toBeInViewport();
      if (mobile) {
        for (const control of [
          page.locator(".project-metadata .owner-value"),
          page.getByRole("button", { name: "新建任务", exact: true }),
          rows.first().locator(".task-assignee .field-value"),
          page.getByRole("button", { name: "筛选任务", exact: true }),
          page.getByRole("button", { name: "添加任务", exact: true }),
        ]) {
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
      }
      await expect(
        page.getByRole("button", { name: "将当前布局设为默认", exact: true }),
      ).toBeHidden();
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(`detail-${mobile ? "mobile" : "desktop"}.png`),
        fullPage: true,
      });
      const initialY = (await rows.first().boundingBox())!.y;
      const status = page.getByLabel("确认报价范围 的状态", { exact: true });
      // Status selector is the only completion control in a project row.
      await expect(rows.first().getByRole("checkbox")).toHaveCount(0);
      await status.selectOption("done");
      await expect(page.locator(".task-feedback")).toBeVisible();
      expect(
        Math.abs((await rows.first().boundingBox())!.y - initialY),
      ).toBeLessThanOrEqual(1);
      await page
        .getByRole("button", { name: "撤销状态更改", exact: true })
        .click();
      await expect(status).toHaveValue("todo");
      await page
        .getByRole("button", { name: "关闭任务反馈", exact: true })
        .click();

      await page.getByRole("button", { name: "筛选任务", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "筛选任务", exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("状态", { exact: true }).selectOption("done");
      await noOverflow(page);
      await dialog.getByRole("button", { name: /查看任务/ }).click();
      await expect(rows).toHaveCount(1);
      await expect(page.locator(".active-task-filters")).toContainText(
        "已完成",
      );
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
      await expect(rows).toHaveCount(2);

      await page.getByRole("button", { name: "视图设置", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "视图设置", exact: true });
      await expect(
        dialog.getByRole("combobox", { name: "任务分组", exact: true }),
      ).toBeVisible();
      await dialog
        .getByLabel("任务分组", { exact: true })
        .selectOption("status");
      await dialog
        .getByLabel("任务排序", { exact: true })
        .selectOption("title");
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(`settings-${mobile ? "mobile" : "desktop"}.png`),
      });
      await dialog
        .getByRole("button", { name: "完成设置", exact: true })
        .click();
      await expect(page.locator(".task-group")).toHaveCount(2);
      await page.getByRole("button", { name: "视图设置", exact: true }).click();
      await dialog.getByLabel("任务分组", { exact: true }).selectOption("none");
      await dialog
        .getByLabel("任务排序", { exact: true })
        .selectOption("manual");
      await dialog
        .getByRole("button", { name: "完成设置", exact: true })
        .click();

      const taskRow = page.locator(`#task-${data.taskId}`);
      await taskRow.locator(".task-date .field-value").click();
      await taskRow.getByLabel("截止日期", { exact: true }).fill("2026-12-01");
      await taskRow.getByRole("button", { name: "保存", exact: true }).click();
      await expect(taskRow.locator(".task-date")).toContainText("12月1日");
      await taskRow
        .getByRole("button", {
          name: "查看任务详情：确认报价范围",
          exact: true,
        })
        .click();
      dialog = page.getByRole("dialog", { name: "任务详情", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("与客户逐项确认材料和交付边界");
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(
          `task-panel-${mobile ? "mobile" : "desktop"}.png`,
        ),
      });
      await dialog
        .getByRole("button", { name: "关闭 任务详情", exact: true })
        .click();
      await expect(
        taskRow.getByRole("button", {
          name: "查看任务详情：确认报价范围",
          exact: true,
        }),
      ).toBeFocused();

      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "新建任务", exact: true });
      await dialog
        .getByRole("textbox", { name: "任务标题", exact: true })
        .fill("新任务默认不排期");
      await dialog.getByRole("button", { name: "添加", exact: true }).click();
      await expect(
        dialog.getByRole("textbox", { name: "任务标题", exact: true }),
      ).toHaveValue("");
      await dialog
        .getByRole("button", { name: "关闭 新建任务", exact: true })
        .click();
      await expect(rows).toHaveCount(3);
      await expect(rows.filter({ hasText: "新任务默认不排期" })).toContainText(
        "未安排",
      );

      await page.getByRole("button", { name: "项目详情", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "项目详情", exact: true });
      await dialog
        .getByRole("button", { name: "编辑 客户", exact: true })
        .click();
      await dialog
        .getByRole("textbox", { name: "客户", exact: true })
        .fill("更新客户");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await expect(dialog).toContainText("更新客户");
      await dialog
        .getByRole("button", { name: "编辑 阶段", exact: true })
        .click();
      await dialog
        .getByRole("combobox", { name: "阶段", exact: true })
        .selectOption("implementation");
      await expect(
        dialog.getByRole("button", { name: "编辑 阶段", exact: true }),
      ).toContainText("实施中");
      await dialog
        .getByRole("button", { name: "编辑 渠道", exact: true })
        .click();
      await dialog
        .getByRole("combobox", { name: "渠道", exact: true })
        .selectOption("jiangong");
      await expect(
        dialog.getByRole("button", { name: "编辑 渠道", exact: true }),
      ).toContainText("建工");
      await noOverflow(page);
      await dialog
        .getByRole("button", { name: "关闭 项目详情", exact: true })
        .click();
      await page.getByRole("tab", { name: "资料", exact: true }).click();
      await expect(page.locator(".project-background")).toContainText(
        "这是项目背景",
      );
      await page.getByRole("tab", { name: "进展", exact: true }).click();
      await expect(page.locator(".progress-history")).toHaveAttribute(
        "open",
        "",
      );
      await expect(page.locator(".progress-composer")).toContainText(
        "已完成现场需求确认",
      );
      await page.getByRole("tab", { name: /任务/ }).click();
      await expect(rows).toHaveCount(3);
      await noOverflow(page);
      // Work planning changes only the work basis, leaving the due date intact.
      await taskRow
        .getByRole("button", { name: "安排工作：确认报价范围", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "改日期", exact: true });
      await dialog.getByLabel("工作周", { exact: true }).fill("2026-11-02");
      await dialog
        .getByRole("button", { name: "保存修改", exact: true })
        .click();
      await expect(taskRow.locator(".task-work")).toContainText("11月2日");
      await expect(taskRow.locator(".task-date")).toContainText("12月1日");

      // Retained progress drafts must not trigger discard prompts on a tab switch.
      const prompts: string[] = [];
      page.on("dialog", async (prompt) => {
        prompts.push(prompt.message());
        await prompt.dismiss();
      });
      await page.getByRole("button", { name: "记进展", exact: true }).click();
      const progressDraft = page.getByRole("textbox", {
        name: "最新上报动态",
        exact: true,
      });
      await progressDraft.fill("切换页签仍然保留的进展草稿");
      await page.getByRole("tab", { name: /任务/ }).click();
      await page.getByRole("tab", { name: "进展", exact: true }).click();
      await expect(progressDraft).toHaveValue("切换页签仍然保留的进展草稿");
      await page
        .locator(".update-editor")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByRole("tab", { name: "进展", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("tab", { name: "资料", exact: true }),
      ).toBeFocused();
      await page.getByRole("tab", { name: /任务/ }).click();
      expect(prompts).toEqual([]);
      await page.getByRole("button", { name: "记进展", exact: true }).click();
      await progressDraft.fill("切换项目之前必须保留的草稿");
      await page.getByRole("tab", { name: /任务/ }).click();
      await page.evaluate(async () => {
        const app = (
          document.getElementById("app") as unknown as {
            __vue_app__: { config: { globalProperties: { $router: Router } } };
          }
        ).__vue_app__;
        await app.config.globalProperties.$router.push("/projects/project-1");
      });
      await expect(page).toHaveURL(
        new RegExp(`/demo/projects/${data.projectId}`),
      );
      expect(prompts).toHaveLength(1);
      await page.getByRole("tab", { name: "进展", exact: true }).click();
      await expect(progressDraft).toHaveValue("切换项目之前必须保留的草稿");
      await page
        .locator(".update-editor")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByRole("tab", { name: /任务/ }).click();

      if (mobile) {
        await page
          .getByRole("button", { name: "新建任务", exact: true })
          .click();
        dialog = page.getByRole("dialog", { name: "新建任务", exact: true });
        await dialog.getByRole("button", { name: "更多", exact: true }).click();
        await page.setViewportSize({ width: 390, height: 440 });
        await dialog
          .getByRole("textbox", { name: "任务标题", exact: true })
          .fill("小屏保存按钮检查");
        const save = dialog.getByRole("button", {
          name: "保存任务",
          exact: true,
        });
        await save.scrollIntoViewIfNeeded();
        await expect(save).toBeInViewport();
        await noOverflow(page);
        await page.screenshot({
          path: info.outputPath("mobile-reduced-height-editor.png"),
        });
        await dialog
          .getByRole("textbox", { name: "任务标题", exact: true })
          .fill("");
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await dialog
          .getByRole("button", { name: "关闭 新建任务", exact: true })
          .click();
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await taskRow
        .getByRole("button", { name: "更多操作：确认报价范围", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "任务操作", exact: true });
      await dialog
        .getByRole("button", { name: "添加子任务", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "添加子任务", exact: true });
      await dialog
        .getByRole("textbox", { name: "任务标题", exact: true })
        .fill("核对报价附件");
      await dialog.getByRole("button", { name: "添加", exact: true }).click();
      await expect(
        dialog.getByRole("textbox", { name: "任务标题", exact: true }),
      ).toHaveValue("");
      await dialog
        .getByRole("button", { name: "关闭 添加子任务", exact: true })
        .click();
      await expect(rows).toHaveCount(4);
      await taskRow
        .getByRole("button", { name: "收起子任务：确认报价范围", exact: true })
        .click();
      await expect(rows).toHaveCount(3);
      await taskRow
        .getByRole("button", { name: "展开子任务：确认报价范围", exact: true })
        .click();
      await expect(rows).toHaveCount(4);
      await noOverflow(page);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });
  });
}
