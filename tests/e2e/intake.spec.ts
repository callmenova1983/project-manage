import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const width of [1536, 375])
  test(`inline intake creates clear text once, reloads and undoes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo/projects");
    await page
      .getByRole("button", { name: "Quick intake", exact: true })
      .click();
    await expect(page).toHaveURL(/projects\?intake=1/);
    await expect(page.locator(".intake-embedded")).toBeVisible();
    await expect(
      page.getByLabel("Notes or pasted table", { exact: true }),
    ).toBeFocused();
    await page
      .getByLabel("Notes or pasted table", { exact: true })
      .fill(
        "Project: Text portal; Task: Review brief\nProject: Text portal; Task: Review launch",
      );
    await page
      .getByRole("button", { name: "Create items", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Created and recorded" }),
    ).toBeVisible();
    await expect(page.locator(".intake-candidate")).toHaveCount(0);
    await expect(page.locator(".intake-history article")).toHaveCount(1);
    await page.reload();
    await page.locator(".intake-history > summary").click();
    await page
      .getByRole("button", { name: "Undo intake", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm undo", exact: true })
      .click();
    await expect(page.getByText("Undone", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("XLSX uses detected columns and creates with one click", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/intake.xlsx");
  await expect(page.getByText("intake.xlsx", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create items", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "View projects", exact: true })
    .click();
  await expect(page.locator(".intake-embedded")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Spreadsheet portal", exact: true }),
  ).toBeVisible();
});
test("closing the panel keeps an unsubmitted draft without creating", async ({
  page,
}) => {
  await page.goto("/demo/projects");
  await page.getByRole("button", { name: "Quick intake", exact: true }).click();
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill("Project: Saved draft; Task: Not created");
  await page
    .getByRole("button", { name: "Close quick intake", exact: true })
    .click();
  await expect(page.locator(".intake-embedded")).toHaveCount(0);
  await page.getByRole("button", { name: "Quick intake", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(
    page.getByLabel("Notes or pasted table", { exact: true }),
  ).toHaveValue("Project: Saved draft; Task: Not created");
  await expect(page.locator(".intake-history article")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Create items", exact: true }).click();
  await page.getByRole("button", { name: "Create items", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Duplicate task");
  await page
    .getByLabel("Allow a new project or task with a matching name")
    .check();
  await page.getByRole("button", { name: "Create items", exact: true }).click();
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
  await page.getByRole("button", { name: "Create items", exact: true }).click();
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
  await page.getByRole("button", { name: "Create items", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Created and recorded" }),
  ).toBeVisible();
  await page.goto("/demo/projects");
  await page
    .getByRole("region", { name: "Projects list", exact: true })
    .getByRole("link", { name: "Intake inbox", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit 补全合成讨论事项", exact: true })
    .click();
  const editor = page.getByRole("form", { name: "Task editor" });
  await editor
    .getByRole("combobox", { name: "Assignee", exact: true })
    .fill("Synthetic reviewer");
  await page.getByRole("option", { name: /Use “Synthetic reviewer”/ }).click();
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
  await page.getByRole("button", { name: "Create items", exact: true }).click();
  await expect(
    page.getByText("1 new projects · 3 new tasks", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create items", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "different details (owner)",
  );
  await expect(page.locator(".intake-history article")).toHaveCount(0);
  await page.getByLabel("Project owner", { exact: true }).last().fill("");
  await page.getByRole("button", { name: "Create items", exact: true }).click();
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
