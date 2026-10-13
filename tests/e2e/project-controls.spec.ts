import { orderedProjectIds } from "../../packages/domain/project-order";
import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`quick collaboration ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });
    test("renames, merges and creates tasks without a full editor", async ({
      page,
    }) => {
      const requests: string[] = [],
        errors: string[] = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/api/"))
          requests.push(r.url());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("project-manage-locale", "en"),
      );
      await page.goto("/demo/projects");
      await page
        .getByRole("link", { name: "Atlas Customer Portal", exact: true })
        .dblclick();
      const rename = page.getByRole("dialog", {
        name: "Edit name, short name and channel",
      });
      await expect(rename).toBeVisible();
      await rename
        .getByLabel("Project name", { exact: true })
        .fill("Full project name");
      await rename.getByLabel("Short name (optional)").fill("School");
      await rename.getByLabel("渠道", { exact: true }).selectOption("jiangong");
      await rename.getByLabel("Project name", { exact: true }).press("Enter");
      await expect(rename).toBeHidden();
      await expect(
        page.getByRole("link", { name: "School", exact: true }),
      ).toBeVisible();
      await page.reload();
      await page.getByRole("link", { name: "School", exact: true }).dblclick();
      await expect(rename.getByLabel("渠道", { exact: true })).toHaveValue(
        "jiangong",
      );
      await rename.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Merge Full project name", exact: true })
        .click();
      const merge = page.getByRole("dialog", { name: "Merge projects" });
      await merge
        .getByRole("checkbox", { name: "Meridian Workspace", exact: true })
        .check();
      await expect(merge.locator(".merge-preview")).toContainText(
        "2 projects → 1 project",
      );
      await merge
        .getByRole("button", { name: "Confirm merge", exact: true })
        .click();
      await expect(merge).toBeHidden();
      await page.reload();
      await expect(page.locator(".project-record")).toHaveCount(19);
      await page.goto("/demo/projects/project-1");
      await page.getByRole("button", { name: "Add task", exact: true }).click();
      const add = page.getByRole("form", {
        name: "Quick add task",
        exact: true,
      });
      await expect(add.locator("input")).toHaveCount(1);
      await add.getByLabel("Task title").fill("Quick task");
      await add.getByLabel("Task title").press("Enter");
      await expect(
        page.getByRole("button", { name: "Quick task", exact: true }),
      ).toBeVisible();
      await add.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Quick task", exact: true })
        .dblclick();
      const row = page.locator(".task-row").filter({
        has: page.getByRole("textbox", { name: "Task title", exact: true }),
      });
      await row.getByLabel("Task title").fill("Renamed task");
      await row.getByLabel("Task title").press("Enter");
      await page
        .getByRole("button", {
          name: "Add subtask to Renamed task",
          exact: true,
        })
        .click();
      const subtask = page.getByRole("form", {
        name: "Quick add subtask",
        exact: true,
      });
      await expect(subtask.locator("input")).toHaveCount(1);
      await subtask.getByLabel("Task title").fill("Quick subtask");
      await subtask.getByLabel("Task title").press("Enter");
      await expect(
        page.getByRole("button", { name: "Quick subtask", exact: true }),
      ).toBeVisible();
      await subtask
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await page.getByText("Project team", { exact: false }).click();
      await expect(page.locator(".member-list")).toContainText("Local demo");
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
}
test("native drag distinguishes reordering from merging and keeps order after reload", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects");
  const source = page.locator(".project-record").filter({
    has: page.getByRole("link", {
      name: "Atlas Customer Portal",
      exact: true,
    }),
  });
  const third = page.locator(".project-record").filter({
    has: page.getByRole("link", { name: "Northstar Analytics", exact: true }),
  });
  const rect = await third.locator(".project-row").boundingBox();
  await source
    .getByRole("button", { name: "Move Atlas Customer Portal", exact: true })
    .dragTo(third.locator(".project-row"), {
      targetPosition: { x: 80, y: rect!.height - 2 },
    });
  await expect(page.locator(".project-record").nth(2)).toContainText(
    "Atlas Customer Portal",
  );
  await page.reload();
  await expect(page.locator(".project-record").nth(2)).toContainText(
    "Atlas Customer Portal",
  );
  const target = page.locator(".project-record").filter({
    has: page.getByRole("link", { name: "Meridian Workspace", exact: true }),
  });
  await source
    .getByRole("button", { name: "Move Atlas Customer Portal", exact: true })
    .dragTo(target.locator(".project-row"));
  const merge = page.getByRole("dialog", { name: "Merge projects" });
  await expect(merge).toBeVisible();
  await expect(
    merge.getByRole("checkbox", { name: "Atlas Customer Portal", exact: true }),
  ).toBeChecked();
  await merge
    .getByRole("button", { name: "Confirm merge", exact: true })
    .click();
  await expect(page.locator(".project-record")).toHaveCount(19);
});

test("dragging onto a stage moves the complete project, preserves its work and follows the active stage filter", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects");
  await expect(page.locator(".project-record").first()).toBeVisible();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  const source = page.locator(".project-record").filter({
    has: page.getByRole("link", {
      name: "Atlas Customer Portal",
      exact: true,
    }),
  });
  const grip = source.getByRole("button", {
    name: "Move Atlas Customer Portal",
    exact: true,
  });
  const old = before.projects.find((p: { id: string }) => p.id === "project-1");
  await grip.dragTo(page.locator(`.stage-tile[data-stage="${old.stage}"]`));
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("project-manage-demo-v1")!,
        ).projects.find((p: { id: string }) => p.id === "project-1").version,
    ),
  ).toBe(old.version);
  await page.locator(`.stage-tile[data-stage="${old.stage}"]`).click();
  const target = page.locator('.stage-tile[data-stage="approved"]');
  const count = Number(
    await target.locator(".stage-tile-heading strong").textContent(),
  );
  await grip.dragTo(target);
  await expect(source.locator(".badge").first()).toContainText(
    "Ready to start",
  );
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(target.locator(".stage-tile-heading strong")).toHaveText(
    String(count + 1),
  );
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
  );
  const changed = after.projects.find(
    (p: { id: string }) => p.id === "project-1",
  );
  expect(changed).toMatchObject({
    ...old,
    stage: "approved",
    version: old.version + 1,
    updatedAt: expect.any(String),
  });
  expect(after.tasks).toEqual(before.tasks);
  expect(orderedProjectIds(after.projects, after.projectOrder)).toEqual(
    orderedProjectIds(before.projects, before.projectOrder),
  );
  expect(after.activities[0].before.stage).toBe(old.stage);
  expect(after.activities[0].after.stage).toBe("approved");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(source.locator(".badge").first()).toContainText(
    "Ready to start",
  );
});

test("a project changed during dragging is not overwritten by a stage drop", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects");
  const grip = page.getByRole("button", {
      name: "Move Atlas Customer Portal",
      exact: true,
    }),
    transfer = await page.evaluateHandle(() => new DataTransfer());
  await grip.dispatchEvent("dragstart", { dataTransfer: transfer });
  await page.evaluate(() => {
    const key = "project-manage-demo-v1",
      state = JSON.parse(localStorage.getItem(key)!);
    const p = state.projects.find((p: { id: string }) => p.id === "project-1");
    p.version++;
    p.latestUpdate = "A newer report from another editor";
    state.revision++;
    localStorage.setItem(key, JSON.stringify(state));
  });
  const target = page.locator('.stage-tile[data-stage="approved"]');
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(target).toHaveClass(/drop-active/);
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".error-box")).toContainText(
    "changed in another tab",
  );
  const result = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!).projects.find(
      (p: { id: string }) => p.id === "project-1",
    ),
  );
  expect(result.stage).toBe("implementation");
  expect(result.latestUpdate).toBe("A newer report from another editor");
});
