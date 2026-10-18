import { test, expect, type Locator, type Page } from "@playwright/test";
import type { WorkspaceApi } from "../../apps/web/src/services/contracts";
import type { ProjectInput } from "../../packages/domain/types";

async function noHorizontalOverflow(page: Page, table?: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  if (table) {
    expect(
      await table.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= -1 &&
          box.right <= innerWidth + 1 &&
          element.scrollWidth <= element.clientWidth + 1
        );
      }),
    ).toBe(true);
  }
}

async function createDemoHistory(page: Page) {
  return page.evaluate(async () => {
    // Exercise the real browser-only adapter so all before/after snapshots,
    // versions, audit actions and pagination inputs follow production logic.
    const modulePath = "/src/services/local.ts";
    const { createLocalApi } = (await import(modulePath)) as {
      createLocalApi: () => WorkspaceApi;
    };
    const local = createLocalApi();
    if (local.mode !== "local")
      throw new Error("Activity fixture requires demo storage");
    const initial = await local.snapshot();
    const ids = initial.projects.slice(0, 2).map((project) => project.id);
    const markers: string[] = [];
    for (let index = 0; index < 8; index++) {
      const snapshot = await local.snapshot();
      const project = snapshot.projects.find(
        (item) => item.id === ids[index % 2],
      )!;
      const input = Object.fromEntries(
        Object.entries(project).filter(
          ([key]) =>
            ![
              "id",
              "version",
              "updatedAt",
              "reportedAt",
              "reportedBy",
            ].includes(key),
        ),
      ) as ProjectInput;
      const marker = `活动时间线回归证据 ${String(index + 1).padStart(2, "0")}`;
      markers.push(marker);
      await local.saveProject(
        {
          ...input,
          owner: `记录负责人 ${index + 1}`,
          latestUpdate: `${marker}：已核对项目资料，等待现场确认。${"详细变更与原始来源应能在手机端完整阅读。".repeat(5)}`,
        },
        project.id,
        project.version,
      );
    }
    const snapshot = await local.snapshot();
    const event = snapshot.activities.find(
      (item) =>
        item.kind === "project" &&
        item.after &&
        "latestUpdate" in item.after &&
        item.after.latestUpdate.startsWith(markers[7]!),
    )!;
    const project = snapshot.projects.find(
      (item) => item.id === event.projectId,
    )!;
    return {
      eventId: event.id,
      projectId: project.id,
      projectName: project.name,
      search: markers[7]!,
      previousSearch: markers[5]!,
      total: snapshot.activities.length,
      filteredTotal: snapshot.activities.filter(
        (item) => item.projectId === project.id,
      ).length,
      realTotal: snapshot.activities.filter(
        (item) => item.source !== "Synthetic demo seed",
      ).length,
    };
  });
}

for (const mobile of [false, true]) {
  test.describe(`activity timeline ${mobile ? "390px mobile" : "desktop"}`, () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      hasTouch: mobile,
      isMobile: mobile,
    });

    test("reads changes and sources, filters and paginates without leaving demo storage", async ({
      page,
    }, testInfo) => {
      const writes: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", async (route) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
          writes.push(`${route.request().method()} ${route.request().url()}`);
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.addInitScript(() => {
        localStorage.setItem("project-manage-locale", "zh-CN");
        localStorage.setItem("project-manage-theme", "light");
      });
      await page.goto("/demo/projects");
      await expect(page.locator(".project-record").first()).toBeVisible();
      const fixture = await createDemoHistory(page);
      expect(fixture.total).toBeGreaterThan(25);
      await page.goto("/demo/activity");
      const table = page.locator("ol.activity-timeline").first();
      const rows = page.locator(".activity-event");
      await expect(table).toBeVisible();
      await expect(rows).toHaveCount(25);
      const record = page.locator(`#activity-${fixture.eventId}`);
      await expect(record).toContainText("Local demo");
      await expect(record).toContainText(fixture.projectName);
      await expect(record.locator("time")).toHaveAttribute(
        "datetime",
        /\d{4}-\d{2}-\d{2}T/,
      );
      await noHorizontalOverflow(page, table);
      await page.screenshot({
        path: testInfo.outputPath(
          `activity-${mobile ? "mobile" : "desktop"}-timeline.png`,
        ),
      });

      const toggle = record.locator("button[aria-expanded]").first();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      if (mobile) {
        const box = await toggle.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await toggle.tap();
      } else await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const detailId = await toggle.getAttribute("aria-controls");
      expect(detailId).toBeTruthy();
      const details = page.locator(`[id="${detailId}"]`);
      await expect(details).toBeVisible();
      await expect(details).toContainText(fixture.search);
      await expect(details).toContainText(fixture.previousSearch);
      await expect(
        details.getByText("Local edit", { exact: true }),
      ).toBeVisible();
      await expect(details).toContainText("记录负责人 6");
      await expect(details).toContainText("记录负责人 8");
      await details.getByText("原始记录数据", { exact: true }).click();
      await expect(details.locator("pre")).toHaveCount(2);
      await expect(details.locator("pre").last()).toContainText(fixture.search);
      await noHorizontalOverflow(page, table);
      await details.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(
          `activity-${mobile ? "mobile" : "desktop"}-details.png`,
        ),
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(details).toBeHidden();

      const search = page.getByRole("textbox", {
        name: "搜索活动",
        exact: true,
      });
      await search.fill(fixture.search);
      await expect(rows).toHaveCount(1);
      await expect(record).toBeVisible();
      await page.getByRole("button", { name: "刷新历史", exact: true }).click();
      await expect(rows).toHaveCount(1);
      await search.fill("");
      await expect(rows).toHaveCount(25);
      const projectFilter = page.getByRole("combobox", {
        name: "按项目筛选活动",
        exact: true,
      });
      await projectFilter.selectOption(fixture.projectId);
      await expect(rows).toHaveCount(fixture.filteredTotal);
      await search.fill("不存在的回归记录");
      await expect(rows).toHaveCount(0);
      await search.fill("");
      await expect(rows).toHaveCount(fixture.filteredTotal);
      await projectFilter.selectOption("");
      await expect(rows).toHaveCount(25);

      const exclude = page.getByRole("checkbox", {
        name: "排除初始化示例记录",
        exact: true,
      });
      await exclude.check();
      await expect(rows).toHaveCount(fixture.realTotal);
      await exclude.uncheck();
      await expect(rows).toHaveCount(25);
      const more = page.getByRole("button", {
        name: "加载更多变更",
        exact: true,
      });
      await more.click();
      await expect(rows).toHaveCount(fixture.total);
      const ids = await rows.evaluateAll((elements) =>
        elements.map((element) => element.id),
      );
      expect(new Set(ids).size).toBe(fixture.total);
      await expect(more).toHaveCount(0);

      const week = page.locator('.activity-filters input[type="date"]');
      await week.fill("2000-01-03");
      await week.blur();
      await expect(rows).toHaveCount(0);
      await page.getByRole("button", { name: "全部日期", exact: true }).click();
      await expect(rows).toHaveCount(25);
      await noHorizontalOverflow(page, table);

      const projectLink = record.getByRole("link", {
        name: fixture.projectName,
        exact: true,
      });
      await expect(projectLink).toHaveAttribute(
        "href",
        `/demo/projects/${fixture.projectId}`,
      );
      await projectLink.click();
      await expect(page).toHaveURL(
        new RegExp(`/demo/projects/${fixture.projectId}$`),
      );
      await page.goBack();
      await expect(page).toHaveURL(/\/demo\/activity$/);
      await expect(rows).toHaveCount(25);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
