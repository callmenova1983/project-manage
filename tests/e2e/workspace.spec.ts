import { test, expect, type Page, type Cookie } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createSeed } from "../../packages/domain/seed.js";
import { projectInput } from "../../packages/domain/types.js";
let csrf = "";
let cookies: Cookie[] = [];
const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (!cookies.length) {
    const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
    const login = await page.request.post("/api/auth/login", {
      data: credentials,
    });
    expect(login.ok()).toBe(true);
    csrf = (await login.json()).csrf;
    cookies = await page.context().cookies();
  } else await page.context().addCookies(cookies);
  const snapshot = await (await page.request.get("/api/workspace")).json();
  const imported = await page.request.post("/api/import", {
    headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
    data: { ...createSeed(), revision: snapshot.revision, confirmed: true },
  });
  expect(imported.ok()).toBe(true);
  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "Projects 20", exact: true }),
  ).toBeVisible();
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});
async function openFirst(page: Page) {
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
}

test("desktop composition, derived statistics, navigation and accessibility", async ({
  page,
}) => {
  await expect(page.locator(".workspace-totals")).toContainText("150 tasks");
  await expect(page.locator(".workspace-totals")).toContainText("90 completed");
  await expect(page.locator(".workspace-totals")).toContainText("60 open");
  await expect(
    page.getByRole("button", { name: "This week 24", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Today 8", exact: true }),
  ).toBeVisible();
  expect(
    (await page.locator(".project-row").first().boundingBox())!.y,
  ).toBeLessThan(360);
  expect(
    await page
      .getByRole("button", { name: "Toggle sidebar" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/desktop-collapsed.png" });
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page
    .getByRole("link", { name: "Atlas Customer Portal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Atlas Customer Portal", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "All projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
test("search combines stage, owner and responsibility; empty state resets", async ({
  page,
}) => {
  await page.getByLabel("Search projects").fill("Atlas");
  await page.getByLabel("Filter by stage").selectOption("implementation");
  await page.getByLabel("Filter by owner").selectOption("Alex Morgan");
  await page.getByLabel("Filter by responsibility").selectOption("Sales");
  await expect(page.locator(".project-record")).toHaveCount(1);
  await page.getByLabel("Filter by stage").selectOption("operations");
  await expect(
    page.getByRole("heading", { name: "No matching projects" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".project-record")).toHaveCount(20);
});
test("project edits, cancellation, unsaved navigation and reload persistence", async ({
  page,
}) => {
  await openFirst(page);
  await page.getByRole("button", { name: "Edit project" }).click();
  await page
    .getByLabel("Latest reported update", { exact: true })
    .fill("A reviewed and saved delivery update.");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project updated");
  await page.reload();
  await openFirst(page);
  await page.getByRole("button", { name: "Edit project" }).click();
  await expect(
    page.getByLabel("Latest reported update", { exact: true }),
  ).toHaveValue("A reviewed and saved delivery update.");
  await page.getByLabel("Project name", { exact: true }).fill("Unsaved title");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("link", { name: "Activity", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Atlas Customer Portal", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Activity", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("A reviewed and saved delivery update.", { exact: true }),
  ).toBeVisible();
});
test("new project, task, subtask, status, paste review and repeated save", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Synthetic Launch");
  await page.getByLabel("Client / organization").fill("Fictional Studio");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project created");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Prepare launch review");
  await page.getByLabel("Today", { exact: true }).check();
  await page.getByRole("button", { name: "Save task", exact: true }).dblclick();
  await expect(
    page.getByRole("button", { name: "Prepare launch review", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Add subtask to Prepare launch review",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Check all acceptance notes");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page
    .getByLabel("Status for Check all acceptance notes")
    .selectOption("done");
  await expect(
    page.getByText("1/1 subtasks completed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Paste tasks", exact: true }).click();
  await page
    .getByLabel("Source text", { exact: true })
    .fill(
      "Review copy\tJamie Chen\t2026-10-12\nConfirm launch\tAlex Morgan\t2026-10-13",
    );
  await page.getByRole("button", { name: "Review 2 tasks" }).click();
  await page.getByRole("button", { name: "Save tasks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review copy", exact: true }),
  ).toHaveCount(1);
  await page.reload();
  await page
    .getByRole("button", { name: "Expand Synthetic Launch", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm launch", exact: true }),
  ).toBeVisible();
});
test("today/week scopes and task editing cancellation", async ({ page }) => {
  await page.getByRole("link", { name: "All tasks", exact: true }).click();
  await expect(page.locator(".task-row")).toHaveCount(24);
  await page.getByRole("button", { name: "Today 8", exact: true }).click();
  await expect(page.locator(".task-row")).toHaveCount(8);
  await page.getByLabel("Filter task status").selectOption("todo");
  await expect(page.locator(".task-row")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Edit Confirm project scope", exact: true })
    .click();
  await page.getByLabel("Task title", { exact: true }).fill("Cancel this edit");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm project scope", exact: true }),
  ).toBeVisible();
});
test("meeting source, ambiguous match, overwrite confirmation and single apply", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Review meeting notes", exact: true })
    .click();
  await expect(
    page.getByText("Rule-assisted review · AI is not connected"),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Meeting notes", exact: true })
    .fill("Atlas and Meridian: review joint handoff");
  await page
    .getByRole("button", { name: "Review suggestions", exact: true })
    .click();
  await expect(page.getByText(/Ambiguous:/)).toBeVisible();
  await page.getByLabel("Project for suggestion 1").selectOption("project-1");
  await page.getByLabel("Action for suggestion 1").selectOption("update");
  await page.getByLabel("Confirm suggestion 1").check();
  await expect(
    page.getByRole("button", {
      name: "Apply 1 confirmed changes",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("I reviewed and confirm replacing this update").check();
  await page
    .getByRole("button", { name: "Apply 1 confirmed changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reviewed and recorded" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View activity", exact: true }).click();
  await page.locator("details").first().locator("summary").click();
  await expect(
    page
      .locator("details")
      .first()
      .getByText(/line 1: Atlas and Meridian: review joint handoff/),
  ).toBeVisible();
});
test("stale editor exposes current version without overwriting it", async ({
  page,
}) => {
  await openFirst(page);
  await page.getByRole("button", { name: "Edit project" }).click();
  await page.getByLabel("Project name", { exact: true }).fill("My stale edit");
  const p = await (await page.request.get("/api/projects/project-1")).json();
  const updated = await page.request.put("/api/projects/project-1", {
    headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
    data: {
      ...projectInput.strip().parse(p),
      name: "Another member saved this",
      version: p.version,
    },
  });
  expect(updated.ok()).toBe(true);
  // Expected 409 is deliberately exercised; browser logs this failed response.
  const allowError = (message: string) => message.includes("409");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This record changed");
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "My stale edit",
  );
  await page
    .getByRole("button", { name: "Load latest version", exact: true })
    .click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Another member saved this",
  );
  for (let i = errors.length - 1; i >= 0; i--)
    if (allowError(errors[i]!)) errors.splice(i, 1);
});
test("export and import preview, cancellation and invalid files", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Workspace settings", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/project-manage.*\.json/);
  await page.getByLabel("Import JSON file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Import JSON file").setInputFiles({
    name: "sample.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(createSeed())),
  });
  await expect(
    page.getByRole("heading", { name: "Review replacement" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replace workspace", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review replacement" }),
  ).not.toBeVisible();
});
test("narrow screen keyboard navigation and accessible controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/mobile-projects.png",
  });
  await page.keyboard.press("Tab");
  await page.getByLabel("Search projects").focus();
  await page.keyboard.type("Atlas");
  await expect(page.locator(".project-record")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Edit project" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/mobile-expanded.png",
    fullPage: true,
  });
});

test("network failure preserves drafts and retry reuses its request identifier", async ({
  page,
}) => {
  await openFirst(page);
  await page.getByRole("button", { name: "Edit project" }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Saved after connection returns");
  let firstKey = "";
  await page.route("**/api/projects/project-1", (route) => {
    firstKey = route.request().headers()["idempotency-key"] ?? "";
    return route.abort("failed");
  });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Unable to reach the server",
  );
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Saved after connection returns",
  );
  await page.unroute("**/api/projects/project-1");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/projects/project-1") && r.method() === "PUT",
  );
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  expect((await request).headers()["idempotency-key"]).toBe(firstKey);
  await expect(
    page.getByRole("link", {
      name: "Saved after connection returns",
      exact: true,
    }),
  ).toBeVisible();
  for (let i = errors.length - 1; i >= 0; i--)
    if (errors[i]!.includes("net::ERR_FAILED")) errors.splice(i, 1);
});
test("confirmed import updates real data and empty state supports recovery", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Workspace settings", exact: true })
    .click();
  await page.getByLabel("Import JSON file").setInputFiles({
    name: "empty.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ schemaVersion: 1, projects: [], tasks: [] }),
    ),
  });
  await page
    .getByLabel(
      "I have exported a backup and confirm replacing the workspace data",
    )
    .check();
  await page
    .getByRole("button", { name: "Replace workspace", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Workspace imported");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your next project starts here" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Projects 0", exact: true }),
  ).toBeVisible();
});
test("switching the subtask parent resets the editor draft", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Atlas Customer Portal", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Add subtask to Confirm project scope",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Add subtask to Share discovery notes",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Child of the selected parent");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Task created");
  const tasks = await (
    await page.request.get("/api/tasks?projectId=project-1")
  ).json();
  expect(
    tasks.find(
      (t: { title: string }) => t.title === "Child of the selected parent",
    ).parentId,
  ).toBe("task-2");
});
test("moving an old task into this week clears old planned days", async ({
  page,
}) => {
  const task = await (
    await page.request.get("/api/tasks?projectId=project-1")
  ).json();
  const t = task.find((x: { id: string }) => x.id === "task-1");
  const { id, version, updatedAt, ...input } = t;
  void updatedAt;
  const result = await page.request.put("/api/tasks/" + id, {
    headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
    data: {
      ...input,
      version,
      workWeek: "2020-01-06",
      workDates: ["2020-01-07"],
    },
  });
  expect(result.ok()).toBe(true);
  await page.goto("/projects/project-1");
  await page
    .getByRole("button", { name: "Edit Confirm project scope", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "This week", exact: true }).check();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Task updated");
  const after = await (
    await page.request.get("/api/tasks?projectId=project-1")
  ).json();
  expect(
    after.find((x: { id: string }) => x.id === "task-1").workDates,
  ).toEqual([]);
});
test("inline notes preserve text, cancellation and reviewed dates", async ({
  page,
}) => {
  await openFirst(page);
  await expect(
    page.getByRole("region", { name: "Readable original table 1" }),
  ).toContainText("Portal access");
  const notes = page.getByRole("textbox", {
    name: "Original notes for Atlas Customer Portal",
  });
  const original = await notes.inputValue();
  await notes.fill("Unsaved notes");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel notes", exact: true }).click();
  await expect(notes).toHaveValue(original);
  const exact =
    "\n  Decision\tOwner\nAtlas access ready\tAlex\nReview next Friday\n  Acceptance follows ✓  ";
  await notes.fill(exact);
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project updated");
  await page.reload();
  await openFirst(page);
  await expect(notes).toHaveValue(exact);
  await page.getByRole("button", { name: /Review date/ }).click();
  await expect(page.locator(".date-review pre")).toContainText(
    "Acceptance follows ✓",
  );
  await page.getByLabel("Apply to task").selectOption("task-1");
  await page.getByLabel("Confirmed due date").fill("2027-01-18");
  await page.getByLabel("I checked the source, task and date").check();
  await expect(
    page.getByRole("button", { name: "Apply reviewed date" }),
  ).toBeDisabled();
  await page.getByLabel("Replace the existing due date").check();
  await page.getByRole("button", { name: "Apply reviewed date" }).click();
  await expect(page.getByRole("status")).toContainText("Reviewed date saved");
  const tasks = await (
    await page.request.get("/api/tasks?projectId=project-1")
  ).json();
  expect(tasks.find((t: { id: string }) => t.id === "task-1").dueDate).toBe(
    "2027-01-18",
  );
});
test("project work scope switches named work and all four counts", async ({
  page,
}) => {
  const meridian = page.locator(".project-record").filter({
    has: page.getByRole("link", { name: "Meridian Workspace", exact: true }),
  });
  await expect(meridian.locator(".project-week")).toContainText(
    "Confirm project scope",
  );
  await expect(meridian.locator(".scope-counts")).toHaveText(
    /To do 0.*In progress 6.*Done 2.*Needs coordination 0/,
  );
  await page.getByRole("button", { name: "Today 8", exact: true }).click();
  await expect(meridian.locator(".project-week")).toContainText(
    "No work planned",
  );
  await expect(
    page.locator(".project-record").first().locator(".project-week"),
  ).toContainText("Confirm project scope");
  await page.getByRole("button", { name: "This week 24", exact: true }).click();
  await expect(meridian.locator(".project-week")).toContainText(
    "Confirm project scope",
  );
});
test("multiple reviewed updates retain exact source and combine once", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Review meeting notes" }).click();
  const source =
    "\n  Atlas: completed scope ✓\tAlex  \n\nAtlas: agreed acceptance checks";
  await page
    .getByRole("textbox", { name: "Meeting notes", exact: true })
    .fill(source);
  await page.getByRole("button", { name: "Review suggestions" }).click();
  await page.getByText("Original source · version 1", { exact: true }).click();
  expect(await page.locator(".original-source pre").textContent()).toBe(source);
  for (let i = 1; i <= 2; i++) {
    await page.getByLabel("Action for suggestion " + i).selectOption("update");
    const card = page.locator(".suggestion-card").nth(i - 1);
    await card
      .getByLabel("I reviewed and confirm replacing this update")
      .check();
    await page.getByLabel("Confirm suggestion " + i).check();
  }
  await expect(
    page.getByRole("heading", {
      name: "Combined update · Atlas Customer Portal",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply 2 confirmed changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Reviewed and recorded" }),
  ).toBeVisible();
  const p = await (await page.request.get("/api/projects/project-1")).json();
  expect(p.latestUpdate).toContain("completed scope ✓");
  expect(p.latestUpdate).toContain("agreed acceptance checks");
});
test("tablet widths contain the table and keep keyboard scrolling available", async ({
  page,
}) => {
  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const table = page.getByRole("region", { name: "Projects list" });
    await expect(page.locator(".project-table-head")).toBeVisible();
    const row = page.locator(".project-row").first();
    const rowBox = (await row.boundingBox())!;
    for (const selector of [".latest-update", ".project-week"]) {
      const cell = (await row.locator(selector).boundingBox())!;
      expect(cell.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(cell.y + cell.height).toBeLessThanOrEqual(
        rowBox.y + rowBox.height + 1,
      );
    }
    await table.focus();
    await expect(table).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("link", { name: "Atlas Customer Portal", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `artifacts/portfolio-tablet-${width}.png` });
  }
});
test("login, invalid credentials and sign out", async ({ page }) => {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill("invalid-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Email or password is incorrect",
  );
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects 20", exact: true }),
  ).toBeVisible();
  for (let i = errors.length - 1; i >= 0; i--)
    if (errors[i]!.includes("401")) errors.splice(i, 1);
});
