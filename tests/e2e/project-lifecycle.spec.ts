import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceApi } from "../../apps/web/src/services/contracts";
import { randomUUID } from "node:crypto";
import { scenarioLogin } from "./scenario-login";
import type { Project, Snapshot } from "../../packages/domain/types";

async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.goto("/demo/projects");
  await expect(page.locator(".project-record").first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const path = "/src/services/local.ts";
    const { createLocalApi } = (await import(path)) as {
      createLocalApi: () => WorkspaceApi;
    };
    const api = createLocalApi();
    const project = await api.saveProject({
      name: "维护项目回归",
      client: "维修客户",
      description: "已交付，偶尔维修",
      stage: "operations",
      owner: "负责人",
      discipline: "Engineering",
      latestUpdate: "已交付验收",
      notes: "原始维修说明",
      aliases: [],
    });
    const task = await api.saveTask({
      projectId: project.id,
      parentId: null,
      title: "保留尚未完成的维修事项",
      description: "原始任务说明",
      status: "todo",
      assignee: "负责人",
      dueDate: null,
      workWeek: null,
      workDates: [],
    });
    return { projectId: project.id, taskId: task.id };
  });
  await page.reload();
  return result;
}

for (const mobile of [false, true]) {
  test.describe(`project lifecycle ${mobile ? "mobile" : "desktop"}`, () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    test("close, find, reactivate, archive and restore without losing work", async ({
      page,
    }) => {
      const { projectId, taskId } = await fixture(page);
      const row = page
        .locator(".project-record")
        .filter({ hasText: "维护项目回归" });
      if (!mobile) await row.hover();
      await row
        .getByRole("button", {
          name: "管理项目状态：维护项目回归",
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "管理项目状态",
        exact: true,
      });
      await expect(
        dialog.getByText("保留尚未完成的维修事项", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "结束项目", exact: true }),
      ).toBeDisabled();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/project-lifecycle/${mobile ? "mobile" : "desktop"}-confirmation.png`,
        fullPage: false,
      });
      await dialog.getByRole("checkbox").check();
      await dialog
        .getByRole("button", { name: "结束项目", exact: true })
        .click();
      await expect(row).toHaveCount(0);
      await page
        .getByRole("combobox", { name: "项目状态", exact: true })
        .selectOption("closed");
      await expect(row).toBeVisible();
      await expect(page.locator(".workspace-totals")).toContainText("1 个任务");
      await expect(page.locator(".workspace-totals")).toContainText("未完成 1");
      await row.scrollIntoViewIfNeeded();
      if (mobile) {
        const actionRows = await row
          .locator(".quick-action")
          .evaluateAll((buttons) =>
            buttons.map((button) =>
              Math.round(button.getBoundingClientRect().top),
            ),
          );
        expect(new Set(actionRows).size).toBe(1);
      }
      await page.screenshot({
        path: `artifacts/project-lifecycle/${mobile ? "mobile" : "desktop"}-closed-list.png`,
        fullPage: false,
      });
      await page.reload();
      await expect(
        page.getByRole("combobox", { name: "项目状态", exact: true }),
      ).toHaveValue("closed");
      await expect(row).toBeVisible();
      await page.goto(`/demo/projects/${projectId}`);
      await expect(
        page.getByRole("heading", { name: "维护项目回归", exact: true }),
      ).toBeVisible();
      const banner = page.locator(".lifecycle-banner");
      await expect(banner).toContainText("该项目已结束");
      await banner.getByRole("button").click();
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      await dialog
        .getByRole("button", { name: "重新激活", exact: true })
        .click();
      await expect(banner).toHaveCount(0);
      await page
        .getByRole("button", { name: "更多项目操作", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "更多项目操作", exact: true })
        .getByRole("button", {
          name: "管理项目状态：维护项目回归",
          exact: true,
        })
        .click();
      await dialog.getByLabel("调整项目状态").selectOption("archived");
      await dialog.getByRole("checkbox").check();
      await dialog
        .getByRole("button", { name: "归档项目", exact: true })
        .click();
      await page.reload();
      await expect(banner).toContainText("已归档项目为只读");
      await expect(
        page.getByRole("button", { name: "新建任务", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "添加任务", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".completion-toggle").first()).toBeDisabled();
      await expect(
        page.getByText("保留尚未完成的维修事项", { exact: true }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/project-lifecycle/${mobile ? "mobile" : "desktop"}-archived.png`,
        fullPage: true,
      });
      await banner.getByRole("button").click();
      await dialog.getByRole("checkbox").check();
      await dialog
        .getByRole("button", { name: "恢复为已结束", exact: true })
        .click();
      await expect(banner).toContainText("该项目已结束");
      const saved = await page.evaluate(
        async ({ projectId, taskId }) => {
          const path = "/src/services/local.ts";
          const { createLocalApi } = (await import(path)) as {
            createLocalApi: () => WorkspaceApi;
          };
          const snapshot = await createLocalApi().snapshot();
          return {
            project: snapshot.projects.find((p) => p.id === projectId),
            task: snapshot.tasks.find((t) => t.id === taskId),
            events: snapshot.activities.filter(
              (a) =>
                a.entityId === projectId && a.source === "Project lifecycle",
            ),
          };
        },
        { projectId, taskId },
      );
      expect(saved.project).toMatchObject({
        lifecycle: "closed",
        stage: "operations",
        notes: "原始维修说明",
        latestUpdate: "已交付验收",
      });
      expect(saved.task).toMatchObject({
        status: "todo",
        title: "保留尚未完成的维修事项",
        description: "原始任务说明",
      });
      expect(saved.events).toHaveLength(4);
    });
  });
}

test("shared workspace saves lifecycle through the real API and preserves archived files", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
  const session = await scenarioLogin(page, "data/e2e-login.json");
  const headers = () => ({
    "x-csrf-token": session.csrf,
    "idempotency-key": randomUUID(),
  });
  const created = await page.request.post("/api/projects", {
    headers: headers(),
    data: {
      name: "共享维护项目",
      client: "测试客户",
      description: "维修验证",
      stage: "operations",
      owner: "负责人",
      discipline: "Engineering",
      latestUpdate: "已交付",
      notes: "保留说明",
      aliases: [],
    },
  });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as Project;
  const upload = await page.request.post(`/api/projects/${project.id}/files`, {
    headers: headers(),
    data: {
      name: "maintenance.txt",
      data: Buffer.from("维修说明原文").toString("base64"),
    },
  });
  expect(upload.ok()).toBe(true);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "更多项目操作", exact: true }).click();
  await page
    .getByRole("dialog", { name: "更多项目操作", exact: true })
    .getByRole("button", { name: "管理项目状态：共享维护项目", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "管理项目状态",
    exact: true,
  });
  await dialog.getByRole("button", { name: "结束项目", exact: true }).click();
  await page.goto("/projects?lifecycle=closed");
  const row = page
    .locator(".project-record")
    .filter({ hasText: "共享维护项目" });
  await expect(row).toBeVisible();
  await row.hover();
  await row
    .getByRole("button", { name: "管理项目状态：共享维护项目", exact: true })
    .click();
  await dialog.getByLabel("调整项目状态").selectOption("archived");
  await dialog.getByRole("button", { name: "归档项目", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto(`/projects/${project.id}#project-files`);
  await expect(page.locator(".lifecycle-banner")).toContainText(
    "已归档项目为只读",
  );
  await expect(
    page.getByRole("button", { name: "maintenance.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传文件", exact: true }),
  ).toBeDisabled();
  await page.reload();
  const saved = (await (
    await page.request.get("/api/workspace")
  ).json()) as Snapshot;
  expect(saved.projects.find((p) => p.id === project.id)).toMatchObject({
    lifecycle: "archived",
    stage: "operations",
    notes: "保留说明",
    latestUpdate: "已交付",
  });
  expect(
    saved.activities.filter(
      (a) => a.entityId === project.id && a.source === "Project lifecycle",
    ),
  ).toHaveLength(2);
  const forbidden = await page.request.post(
    `/api/projects/${project.id}/files`,
    {
      headers: headers(),
      data: {
        name: "forbidden.txt",
        data: Buffer.from("forbidden").toString("base64"),
      },
    },
  );
  expect(forbidden.status()).toBe(409);
});
