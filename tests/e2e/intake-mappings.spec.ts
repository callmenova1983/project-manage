import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { scenarioLogin } from "./scenario-login";

for (const width of [1536, 390])
  test(`saved Excel mapping is reusable, editable and removable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (width === 390)
      await page.addInitScript(() =>
        localStorage.setItem("project-manage-locale", "zh-CN"),
      );
    const zh = width === 390;
    await page.goto("/demo/intake");
    await page
      .locator('input[type="file"]')
      .setInputFiles("tests/fixtures/intake.xlsx");
    await expect(page.locator(".intake-mapping select")).toHaveCount(5);
    await page
      .locator(".intake-mapping select")
      .nth(2)
      .selectOption("assignee");
    await page
      .getByLabel(zh ? "映射名称" : "Mapping name", { exact: true })
      .fill("Synthetic weekly layout");
    await page
      .getByRole("button", {
        name: zh ? "保存映射" : "Save mapping",
        exact: true,
      })
      .click();
    await expect(
      page.locator(".mapping-templates").getByRole("status"),
    ).toContainText(zh ? "映射已按账号" : "Mapping saved");
    const stored = await page.evaluate(
      () =>
        Object.entries(localStorage).find(([k]) =>
          k.startsWith("project-manage-column-mappings-v1:"),
        )?.[1],
    );
    expect(stored).not.toContain("Spreadsheet portal");
    expect(stored).not.toContain("Review import");
    page.once("dialog", (d) => d.accept());
    await page.reload();
    await page
      .getByRole("button", {
        name: zh ? "丢弃草稿" : "Discard draft",
        exact: true,
      })
      .click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "reordered.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Task,Owner,Project,Client,Due date\nNew mapped task,Synthetic reviewer,Reused template project,Synthetic Co,2026-10-20",
      ),
    });
    const saved = page.getByLabel(zh ? "已保存映射" : "Saved mapping", {
      exact: true,
    });
    await saved.selectOption({ label: "Synthetic weekly layout" });
    await page
      .getByRole("button", {
        name: zh ? "应用映射" : "Apply mapping",
        exact: true,
      })
      .click();
    await expect(page.locator(".intake-mapping select").nth(1)).toHaveValue(
      "assignee",
    );
    await page.locator(".intake-mapping select").nth(1).selectOption("owner");
    await page
      .getByRole("button", {
        name: zh ? "更新映射" : "Update mapping",
        exact: true,
      })
      .click();
    await page.locator(".intake-mapping select").nth(1).selectOption("ignore");
    await page
      .getByRole("button", {
        name: zh ? "应用映射" : "Apply mapping",
        exact: true,
      })
      .click();
    await expect(page.locator(".intake-mapping select").nth(1)).toHaveValue(
      "owner",
    );
    mkdirSync("artifacts/personal-work", { recursive: true });
    await page.screenshot({
      path: `artifacts/personal-work/mappings-${width}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("button", {
        name: zh ? "删除映射" : "Delete mapping",
        exact: true,
      })
      .click();
    await expect(saved.locator("option")).toHaveCount(1);
    await page
      .getByRole("button", {
        name: zh ? "审阅候选" : "Review candidates",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel(zh ? "项目负责人" : "Project owner", { exact: true }),
    ).toHaveValue("Synthetic reviewer");
    expect(errors).toEqual([]);
  });

test("decision filtering keeps all selected source rows and does not bypass ambiguity", async ({
  page,
}) => {
  await page.goto("/demo/intake");
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill(
      "Atlas:\n- Synthetic clear task\n- Coordinate Meridian\nProject: Synthetic incomplete\n- Capture first",
    );
  await page
    .getByRole("button", { name: "Review candidates", exact: true })
    .click();
  await expect(page.locator(".intake-candidate")).toHaveCount(3);
  await page
    .getByLabel("Review view", { exact: true })
    .selectOption("decisions");
  await expect(page.locator(".intake-candidate")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Target project", exact: true })
    .selectOption("project-2");
  await page
    .getByLabel("I reviewed the selected rows and their target projects")
    .check();
  await expect(
    page.getByRole("button", { name: "Create confirmed items", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I confirm this target despite multiple project matches")
    .focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".intake-candidate")).toHaveCount(0);
  await expect(page.getByLabel("Review view", { exact: true })).toBeFocused();
  await page.getByLabel("Review view", { exact: true }).selectOption("all");
  await expect(page.locator(".intake-candidate")).toHaveCount(3);
  await page.locator(".intake-source-proof summary").nth(1).click();
  await expect(page.locator(".intake-source-proof").nth(1)).toContainText(
    "Coordinate Meridian",
  );
  mkdirSync("artifacts/personal-work", { recursive: true });
  await page.screenshot({
    path: "artifacts/personal-work/grouped-review.png",
    fullPage: true,
  });
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
  expect(after.tasks.length).toBe(before.tasks.length + 3);
  expect(
    after.projects.find(
      (p: { name: string }) => p.name === "Synthetic incomplete",
    ),
  ).toMatchObject({ client: "", stage: "unclassified" });
  await page.getByRole("button", { name: "Undo intake", exact: true }).click();
  await page.getByRole("button", { name: "Confirm undo", exact: true }).click();
  const undone = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.projects).toEqual(before.projects);
});

test("saved mappings remain private across account switching in the same browser", async ({
  page,
}) => {
  test.setTimeout(60000);
  const member = "data/e2e-login.json",
    admin = "data/e2e-admin-login.json";
  await scenarioLogin(page, member);
  await page.goto("/intake");
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/intake.xlsx");
  await page
    .getByLabel("Mapping name", { exact: true })
    .fill("Member private mapping");
  await page.getByRole("button", { name: "Save mapping", exact: true }).click();
  await expect(
    page.locator(".mapping-templates").getByRole("status"),
  ).toContainText("Mapping saved");
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await scenarioLogin(page, admin);
  await page.goto("/intake");
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/intake.xlsx");
  await expect(
    page.getByLabel("Saved mapping", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await scenarioLogin(page, member);
  await page.goto("/intake");
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/intake.xlsx");
  await expect(
    page.getByLabel("Saved mapping", { exact: true }).locator("option"),
  ).toHaveCount(2);
});
