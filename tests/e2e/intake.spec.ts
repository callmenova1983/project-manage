import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const width of [1536, 375])
  test(`text intake review, atomic create, reload and undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 844 : 1024 });
    const errors: string[] = [],
      calls: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/")) calls.push(r.url());
    });
    await page.goto("/demo/intake");
    await page
      .getByLabel("Notes or pasted table", { exact: true })
      .fill(
        "Project: Text portal; Client: Synthetic Co; Owner: Lin; Task: Review brief; Due: 2026-10-20\nProject: Text portal; Client: Synthetic Co; Owner: Lin; Task: Review launch",
      );
    await page
      .getByRole("button", { name: "Review candidates", exact: true })
      .click();
    await expect(page.getByText("1 new projects · 2 new tasks")).toBeVisible();
    await page
      .getByLabel("I reviewed the selected rows and their target projects")
      .check();
    await page
      .getByRole("button", { name: "Create confirmed items", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Created and recorded" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator(".intake-history article")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Undo intake", exact: true })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirm undo" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Undo intake", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm undo" }).click();
    await expect(page.getByText("Undone", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(calls).toEqual([]);
  });
test("XLSX mapping and Chinese review preserve original cells, cancel and unsaved navigation", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await page.locator(".language-select").selectOption("zh-CN");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/intake.xlsx");
  await expect(page.getByText("intake.xlsx", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "审阅候选", exact: true }).click();
  await expect(page.getByText("新建 1 个项目 · 2 个任务")).toBeVisible();
  await page.locator(".intake-source-proof summary").first().click();
  await expect(page.locator(".intake-source-proof pre").first()).toContainText(
    "Spreadsheet portal",
  );
  await page.screenshot({
    path: "artifacts/intake-xlsx-review.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "项目", exact: true }).last().click();
  await expect(page).toHaveURL(/intake/);
  await page.getByLabel("我已审阅所选条目及其目标项目").check();
  await page
    .getByRole("button", { name: "创建已确认事项", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "已创建并留存记录" }),
  ).toBeVisible();
  await page.goto("/demo/projects");
  await expect(
    page.getByRole("link", { name: "Spreadsheet portal", exact: true }),
  ).toBeVisible();
});
test("ambiguous dates and duplicate tasks require review instead of silent creation", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill(
      "Project: Atlas Customer Portal; Task: Confirm project scope; Due: tomorrow",
    );
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Review the flagged");
  await page.getByLabel("I reviewed the flagged details").check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Duplicate task");
  await page
    .getByLabel("Allow a new project or task with a matching name")
    .check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded" }),
  ).toBeVisible();
});
