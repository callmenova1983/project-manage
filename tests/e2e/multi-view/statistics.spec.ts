import { test, expect } from "@playwright/test";
import { resetWorkspace, snapshot } from "./support";
import { projectStatistics } from "../../../packages/domain/people-project-statistics";
import { defaultStatisticsQuery } from "../../../packages/domain/statistics-query";
test("statistics filters, numeric drilldown, settings and mobile remain usable", async ({
  page,
}) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const data = await snapshot(page);
  await page.goto("/directory?tab=statistics");
  await expect(
    page.getByRole("heading", { name: "人员与项目统计" }),
  ).toBeVisible();
  const expected = projectStatistics(data, defaultStatisticsQuery(), {
    timeZone: data.settings?.timeZone,
  });
  await expect(page.locator(".condition-tags")).toContainText(
    `${expected.rows.length} 个责任组`,
  );
  const row = expected.rows.find((r) => r.key !== "none")!;
  await page
    .getByRole("button", {
      name: `${row.name} 未完成 ${row.open}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: `${row.name} · 未完成` }),
  ).toBeVisible();
  await expect(page.locator(".statistics-detail")).toContainText(
    `${row.open} 项`,
  );
  await page
    .getByRole("button", { name: "按任务总数排序", exact: true })
    .click();
  await expect(page.locator(".condition-tags")).toContainText("任务总数降序");
  await page.getByRole("textbox", { name: "搜索负责人" }).fill("无此人员xxx");
  await expect(page.locator(".condition-tags")).toContainText("0 个责任组");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(page.locator(".condition-tags")).toContainText("任务总数降序");
  await page.locator("summary").filter({ hasText: "常用视图" }).click();
  await page.getByRole("textbox", { name: "常用视图名称" }).fill("测试统计");
  await page.getByRole("button", { name: "保存当前视图", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "测试统计", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".condition-tags")).toContainText("任务总数降序");
  await page.getByRole("button", { name: "任务负责人", exact: true }).click();
  await expect(page.locator(".scope-note")).toContainText("直接分派");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "项目负责人", exact: true }).click();
  await page.locator(".person-name").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("restores views, rejects invalid scopes, supports keyboard sort and project return", async ({
  page,
}) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  await page.goto("/directory?tab=statistics");
  const sort = page.locator('button[data-stat-column="open"]');
  await sort.focus();
  await page.keyboard.press("Enter");
  await expect(sort.locator("xpath=ancestor::th")).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await page.keyboard.press("Enter");
  await expect(sort.locator("xpath=ancestor::th")).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.getByRole("button", { name: "任务负责人", exact: true }).click();
  await page.goto("/directory?tab=statistics");
  await expect(
    page.getByRole("button", { name: "任务负责人", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "项目负责人", exact: true }).click();
  await page.locator(".cell-link").first().click();
  const group = await page.locator(".statistics-detail h2").innerText();
  await page.locator(".detail-link").first().click();
  await expect(page).toHaveURL(/\/projects\//);
  await page.goBack();
  await expect(page.locator(".statistics-detail h2")).toHaveText(group);
  await page.goto(
    "/directory?tab=statistics&statistics=" +
      encodeURIComponent(
        JSON.stringify({ ...defaultStatisticsQuery(), projects: ["deleted"] }),
      ),
  );
  await expect(page.getByRole("alert")).toContainText("已失效");
  await expect(page.locator(".condition-tags")).toContainText("0 个责任组");
  await page.getByRole("button", { name: "清除无效条件" }).click();
  await expect(
    page.locator(".statistics-card .cell-link").first(),
  ).toBeVisible();
});

test("defers refresh atomically during interaction and clears deleted selection", async ({
  page,
}) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  let data = await snapshot(page);
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto("/directory?tab=statistics");
  await page.locator(".cell-link").first().click();
  const before = await page.locator(".stats-summary").innerText();
  // Keep a keyboard focus in the table while a real polling response changes data.
  await page.locator(".cell-link").first().focus();
  await page.keyboard.press("ArrowRight");
  data = { ...data, projects: [], tasks: [], revision: data.revision + 1 };
  await expect(
    page.getByRole("button", { name: "有新数据 · 更新" }),
  ).toBeVisible({ timeout: 30000 });
  expect(await page.locator(".stats-summary").innerText()).toBe(before);
  await page.getByRole("button", { name: "有新数据 · 更新" }).click();
  await expect(page.locator(".condition-tags")).toContainText("0 个责任组");
  await expect(
    page.getByRole("status").filter({ hasText: "原选中责任组" }),
  ).toBeVisible();
});

test("200 projects and 5000 tasks: full totals, pagination and browser latency", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.PM_STATISTICS_PERFORMANCE !== "1",
    "用户要求暂缓性能测试；仅显式启用时运行",
  );
  await resetWorkspace(page, { language: "zh", theme: "light" });
  const source = await snapshot(page);
  const data = {
    ...source,
    projects: Array.from({ length: 200 }, (_, i) => ({
      ...source.projects[0]!,
      id: `scale-p-${i}`,
      name: `规模项目${i}`,
      owner: `负责人${String(i).padStart(3, "0")}`,
      ownerId: null,
    })),
    tasks: Array.from({ length: 5000 }, (_, i) => ({
      ...source.tasks[0]!,
      id: `scale-t-${i}`,
      projectId: `scale-p-${i % 200}`,
      parentId: null,
      voided: undefined,
      assigneeId: null,
      assignee: "任务员",
      status: "todo" as const,
    })),
  };
  await page.route("**/api/workspace", (r) => r.fulfill({ json: data }));
  const start = Date.now();
  await page.goto("/directory?tab=statistics");
  await expect(page.locator(".condition-tags")).toContainText("200 个责任组");
  const initial = Date.now() - start;
  await expect(page.locator(".totals-line")).toContainText("任务总数 5000");
  expect(
    await page.locator(".statistics-card").first().locator("tbody tr").count(),
  ).toBe(25);
  const samples: number[] = [];
  for (let i = 0; i < 12; i++) {
    const duration = await page.evaluate(async (i) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="搜索负责人"]',
      )!;
      const start = performance.now();
      const value = i % 2 ? "负责人001" : "负责人000";
      const painted = new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("search render timeout"));
        }, 5000);
        const observer = new MutationObserver(() => {
          if (
            document
              .querySelector(".condition-tags")
              ?.textContent?.includes("1 个责任组") &&
            document
              .querySelector(".statistics-card tbody")
              ?.textContent?.includes(value)
          ) {
            observer.disconnect();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(timeout);
                resolve(performance.now() - start);
              }),
            );
          }
        });
        observer.observe(document.querySelector(".statistics-columns")!, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      return painted;
    }, i);
    samples.push(duration);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  await testInfo.attach("browser-performance.json", {
    body: JSON.stringify(
      {
        projects: 200,
        tasks: 5000,
        initial,
        samples,
        p95,
        method:
          "input + Enter immediate query submission to two animation frames after correct result; no debounce",
        browser: "Chromium desktop",
        viewport: page.viewportSize(),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(p95).toBeLessThanOrEqual(200);
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  for (const width of [1536, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`statistics-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("functional responsive layouts, visible conditions and readonly interactions", async ({
  page,
}, testInfo) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  const mutations: string[] = [];
  page.on("request", (r) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) &&
      /\/api\/(projects|tasks|directory)/.test(r.url())
    )
      mutations.push(r.url());
  });
  await page.goto("/directory?tab=statistics");
  await page.getByRole("button", { name: "有待协调", exact: true }).click();
  await expect(page.locator(".condition-tags")).toContainText("仅显示有待协调");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.locator(".cell-link").first().click();
  for (const width of [1536, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`functional-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(mutations).toEqual([]);
});

test("network recovery keeps successful data and explicit view navigation supports Back", async ({
  page,
}) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  await page.goto("/directory?tab=statistics");
  await page.getByRole("button", { name: "任务负责人", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "项目负责人", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const before = await page.locator(".stats-summary").innerText();
  let fail = true;
  await page.route("**/api/workspace", (r) =>
    fail
      ? r.fulfill({ status: 503, json: { error: "Temporary failure" } })
      : r.continue(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.locator(".statistics-page .error-box").first(),
  ).toContainText("保留上次成功数据");
  expect(await page.locator(".stats-summary").innerText()).toBe(before);
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".statistics-page .error-box")).toHaveCount(0);
  expect(await page.locator(".stats-summary").innerText()).toBe(before);
});

test("all statistic counts including total activate on desktop and mobile", async ({
  page,
}, testInfo) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const data = await snapshot(page);
  const result = projectStatistics(data, defaultStatisticsQuery(), {
    timeZone: data.settings?.timeZone,
  });
  const row = result.rows[0]!;
  await page.goto("/directory?tab=statistics");
  for (const [key, label, title] of [
    ["total", "任务总数", "全部任务"],
    ["open", "未完成", "未完成"],
    ["done", "已完成", "已完成"],
    ["blocked", "待协调", "待协调"],
    ["overdue", "明确逾期", "明确逾期"],
  ] as const) {
    await page
      .getByRole("button", {
        name: `${row.name} ${label} ${row[key]}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: `${row.name} · ${title}` }),
    ).toBeVisible();
    await expect(page.locator(".statistics-detail p")).toContainText(
      `${row[key]} 项`,
    );
  }
  await page.screenshot({
    path: testInfo.outputPath("compact-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .getByRole("button", {
      name: `${row.name} 任务总数 ${row.total}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `${row.name} · 全部任务` }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mobile-details.png"),
    animations: "disabled",
    fullPage: false,
  });
  await page.getByRole("button", { name: "关闭此对话框" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("mobile-cards.png"),
    animations: "disabled",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("pending refresh does not swallow task-total activation between pointerup and click", async ({
  page,
}) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  let data = await snapshot(page);
  const row = projectStatistics(data, defaultStatisticsQuery(), {
    timeZone: data.settings?.timeZone,
  }).rows[0]!;
  await page.route("**/api/workspace", (r) => r.fulfill({ json: data }));
  await page.goto("/directory?tab=statistics");
  const button = page.getByRole("button", {
    name: `${row.name} 任务总数 ${row.total}`,
    exact: true,
  });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  data = {
    ...data,
    revision: data.revision + 1,
    tasks: data.tasks.map((t) => ({
      ...t,
      dueDate: row.tasks.some((r) => r.id === t.id) ? null : "2000-01-01",
    })),
  };
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("button", { name: "有新数据 · 更新" }),
  ).toBeVisible();
  await page.mouse.up();
  await expect(
    page.getByRole("heading", { name: `${row.name} · 全部任务` }),
  ).toBeVisible();
});
