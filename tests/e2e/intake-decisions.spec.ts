import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

for (const width of [1536, 390])
  for (const zh of [false, true])
    for (const theme of ["dark", "light"])
      test(`review decisions, source and draft recovery at ${width}px ${zh ? "zh" : "en"} ${theme}`, async ({
        page,
      }) => {
        const tr = (en: string, cn: string) => (zh ? cn : en);
        const errors: string[] = [],
          calls: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        page.on("request", (r) => {
          if (r.url().includes("/api/")) calls.push(r.url());
        });
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1024,
        });
        await page.addInitScript(
          ({ zh, theme }) => {
            localStorage.setItem("project-manage-locale", zh ? "zh-CN" : "en");
            localStorage.setItem("project-manage-theme", theme);
          },
          { zh, theme },
        );
        await page.goto("/demo/intake");
        const original =
          "Project,Task,Due date,Status\nAtlas Customer Portal,Synthetic corrected decision,not-a-date,unknown-status";
        await page
          .getByLabel(tr("Notes or pasted table", "文字或粘贴的表格"), {
            exact: true,
          })
          .fill(original);
        await page
          .getByRole("button", {
            name: tr("Review candidates", "审阅候选"),
            exact: true,
          })
          .click();
        const review = page.getByLabel(tr("Review view", "审阅视图"), {
          exact: true,
        });
        await review.selectOption("decisions");
        await expect(page.locator(".intake-candidate")).toHaveCount(1);
        await page
          .getByLabel(tr("Due date", "截止日期"), { exact: true })
          .fill("2026-10-30");
        await page
          .getByRole("combobox", {
            name: tr("Task status", "任务状态"),
            exact: true,
          })
          .selectOption("done");
        await review.focus();
        await expect(page.locator(".intake-candidate")).toHaveCount(0);
        page.once("dialog", (d) => d.accept());
        await page.reload();
        await page
          .getByRole("button", {
            name: tr("Restore draft", "恢复草稿"),
            exact: true,
          })
          .click();
        const confirmation = page.getByLabel(
          tr(
            "I reviewed the selected rows and their target projects",
            "我已审阅所选条目及其目标项目",
          ),
        );
        await expect(confirmation).not.toBeChecked();
        await expect(
          page.getByLabel(tr("Due date", "截止日期"), { exact: true }),
        ).toHaveValue("2026-10-30");
        await expect(
          page.getByRole("combobox", {
            name: tr("Task status", "任务状态"),
            exact: true,
          }),
        ).toHaveValue("done");
        await expect(page.locator(".intake-warnings")).toHaveCount(0);
        await page.locator(".intake-source-proof summary").click();
        await expect(page.locator(".intake-source-proof")).toContainText(
          "not-a-date",
        );
        await expect(page.locator(".intake-source-proof")).toContainText(
          "unknown-status",
        );
        mkdirSync("artifacts/m2-decisions", { recursive: true });
        await page.screenshot({
          path: `artifacts/m2-decisions/review-${width}-${zh ? "zh" : "en"}-${theme}.png`,
          fullPage: true,
        });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        const before = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
        );
        await confirmation.check();
        await page
          .getByRole("button", {
            name: tr("Create confirmed items", "创建已确认事项"),
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: tr("Created and recorded", "已创建并留存记录"),
            exact: true,
          }),
        ).toBeVisible();
        const after = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
        );
        expect(after.projects).toEqual(before.projects);
        expect(after.tasks.length).toBe(before.tasks.length + 1);
        expect(
          after.tasks.find(
            (t: { title: string }) =>
              t.title === "Synthetic corrected decision",
          ),
        ).toMatchObject({ dueDate: "2026-10-30", status: "done" });
        await page.reload();
        await expect(page.locator(".intake-history article")).toHaveCount(1);
        await page
          .getByRole("button", {
            name: tr("Undo intake", "撤销录入"),
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: tr("Confirm undo", "确认撤销"),
            exact: true,
          })
          .click();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("project-manage-demo-v1")!).tasks,
          ),
        ).toEqual(before.tasks);
        expect(errors).toEqual([]);
        expect(calls).toEqual([]);
      });

test("an existing project without a task stays visible for a decision", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill(
      "Project,Task\nAtlas Customer Portal,Synthetic existing row\nAtlas Customer Portal,",
    );
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  await expect(page.locator(".intake-candidate")).toHaveCount(2);
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await expect(
    page.getByRole("button", { name: "Create confirmed items", exact: true }),
  ).toBeDisabled();
  mkdirSync("artifacts/m2-decisions", { recursive: true });
  await page.screenshot({
    path: "artifacts/m2-decisions/missing-task.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add a task to this row", exact: true })
    .click();
  await expect(page.locator(".intake-task-title").last()).toBeFocused();
  const review = page.getByLabel("Review view", { exact: true });
  await review.selectOption("decisions");
  await expect(page.locator(".intake-candidate")).toHaveCount(1);
  await page.getByLabel("Task title", { exact: true }).focus();
  await page.keyboard.type("Synthetic completed title");
  await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
    "Synthetic completed title",
  );
  await page.getByLabel("Assignee", { exact: true }).fill("Synthetic reviewer");
  await review.focus();
  await expect(page.locator(".intake-candidate")).toHaveCount(0);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("link", { name: "Projects", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/intake/);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("link", { name: "Projects", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/projects/);
  await page.goBack();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(page.locator(".intake-task-title").last()).toHaveValue(
    "Synthetic completed title",
  );
  await expect(
    page.getByLabel("I reviewed the selected rows and their target projects"),
  ).not.toBeChecked();
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  expect(after.projects).toEqual(before.projects);
  expect(after.tasks.length).toBe(before.tasks.length + 2);
  expect(
    after.tasks.find(
      (t: { title: string }) => t.title === "Synthetic completed title",
    ),
  ).toMatchObject({ assignee: "Synthetic reviewer", dueDate: null });
});

test("ten clear spreadsheet rows need one mapping and one final review with no optional fields", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-ten.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Project,Task\n" +
        Array.from(
          { length: 10 },
          (_, i) => `Atlas Customer Portal,Synthetic ten-row task ${i + 1}`,
        ).join("\n"),
    ),
  });
  await expect(page.locator(".intake-mapping select")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await expect(page.locator(".intake-candidate")).toHaveCount(10);
  await expect(
    page.getByRole("option", { name: "Needs decisions (0)", exact: true }),
  ).toHaveCount(1);
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  expect(after.projects).toEqual(before.projects);
  expect(after.tasks.length).toBe(before.tasks.length + 10);
  expect(
    after.tasks
      .filter((t: { title: string }) => t.title.startsWith("Synthetic ten-row"))
      .every(
        (t: { assignee: string; dueDate: unknown }) =>
          t.assignee === "Unassigned" && t.dueDate === null,
      ),
  ).toBe(true);
});
