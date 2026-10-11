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

test("minimal capture saves first, then missing details and project assignment can be completed", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill("任务：补全合成讨论事项；日期：下周五");
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await expect(page.getByLabel("Client", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Stage", exact: true }),
  ).toHaveValue("unclassified");
  await expect(page.getByLabel("Due date", { exact: true })).toHaveValue("");
  const candidateBox = await page.locator(".intake-candidate").boundingBox();
  const confirmationBox = await page.locator(".intake-confirm").boundingBox();
  expect(confirmationBox!.y).toBeGreaterThanOrEqual(
    candidateBox!.y + candidateBox!.height,
  );
  await page.screenshot({
    path: "artifacts/progressive-intake-review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/progressive-intake-review-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded" }),
  ).toBeVisible();
  await page.goto("/demo/projects");
  await page
    .getByRole("region", { name: "Projects list", exact: true })
    .getByRole("link", { name: "Intake inbox", exact: true })
    .click();
  await page
    .getByRole("button", { name: "补全合成讨论事项", exact: true })
    .click();
  const editor = page.getByRole("form", { name: "Task editor" });
  await editor
    .getByLabel("Assignee", { exact: true })
    .fill("Synthetic reviewer");
  await editor.getByLabel("Due date", { exact: true }).fill("2026-10-16");
  page.once("dialog", (d) => d.dismiss());
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeVisible();
  await editor
    .getByLabel("Project assignment", { exact: true })
    .selectOption({ label: "Atlas Customer Portal" });
  await editor.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.goto(
    "/demo/tasks?scope=all&q=" + encodeURIComponent("补全合成讨论事项"),
  );
  await expect(page.locator(".task-row")).toHaveCount(1);
  await expect(page.locator(".task-row")).toContainText(
    "Atlas Customer Portal",
  );
  await expect(page.locator(".task-row")).toContainText("Synthetic reviewer");
  await page.reload();
  await expect(page.locator(".task-row")).toContainText("Synthetic reviewer");
  await page.screenshot({
    path: "artifacts/progressive-intake-completed.png",
    fullPage: true,
  });
});

test("distributed new-project details merge once and conflicting owners stay reviewable", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/demo/intake");
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill(
      "项目：Distributed draft；任务：First item\n项目：Distributed draft；客户：Synthetic client；负责人：First owner；任务：Second item\n项目：Distributed draft；负责人：Conflicting owner；任务：Third item",
    );
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await expect(
    page.getByText("1 new projects · 3 new tasks", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "different details (owner)",
  );
  await expect(page.locator(".intake-history article")).toHaveCount(0);
  await page.getByLabel("Project owner", { exact: true }).last().fill("");
  await page
    .getByRole("button", { name: "Create confirmed items", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded" }),
  ).toBeVisible();
  await page.goto("/demo/projects");
  await expect(
    page.getByRole("link", { name: "Distributed draft", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("link", { name: "Distributed draft", exact: true })
    .click();
  await expect(page.getByRole("main")).toContainText("Synthetic client");
  await expect(page.getByRole("main")).toContainText("First owner");
  await expect(page.locator(".task-row")).toHaveCount(3);
});
