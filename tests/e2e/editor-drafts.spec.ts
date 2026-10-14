import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { scenarioLogin } from "./scenario-login";
test.setTimeout(60000);
const errors: string[] = [];
const expectedErrors = new Set<string>();
test.beforeEach(({ page }) => {
  errors.length = 0;
  expectedErrors.clear();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !expectedErrors.has(
        new URL(m.location().url || "/", "http://localhost").pathname,
      )
    )
      errors.push(m.text());
  });
  mkdirSync("artifacts/personal-work", { recursive: true });
});
test.afterEach(() => expect(errors).toEqual([]));
async function reloadDirty(page: Page) {
  page.once("dialog", (d) => d.accept());
  await page.reload();
}
const projectForm = (page: Page) =>
  page.getByRole("form", { name: "Project editor", exact: true });

for (const width of [1536, 390])
  test(`project edits restore only after version check, validate and save once at ${width}px`, async ({
    page,
  }) => {
    const zh = width === 390;
    await page.setViewportSize({ width, height: zh ? 844 : 1024 });
    if (zh)
      await page.addInitScript(() =>
        localStorage.setItem("project-manage-locale", "zh-CN"),
      );
    await page.goto("/demo/projects/project-1");
    await page
      .getByRole("button", {
        name: zh ? "编辑项目" : "Edit project",
        exact: true,
      })
      .click();
    const form = page.getByRole("form", {
      name: zh ? "项目编辑器" : "Project editor",
      exact: true,
    });
    await form
      .getByLabel(zh ? "项目名称" : "Project name", { exact: true })
      .fill("");
    await form
      .getByLabel(zh ? "描述" : "Description", { exact: true })
      .fill("  Synthetic unsaved description  ");
    await form
      .getByLabel(zh ? "别名，以英文逗号分隔" : "Aliases, comma separated", {
        exact: true,
      })
      .fill("  First alias, Second alias  ");
    await reloadDirty(page);
    await page
      .getByRole("button", {
        name: zh ? "编辑项目" : "Edit project",
        exact: true,
      })
      .click();
    await expect(
      form.getByLabel(zh ? "项目名称" : "Project name", { exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `artifacts/personal-work/project-draft-${width}.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await form
      .getByRole("button", {
        name: zh ? "核验并恢复草稿" : "Check and restore draft",
        exact: true,
      })
      .click();
    await expect(
      form.getByLabel(zh ? "项目名称" : "Project name", { exact: true }),
    ).toHaveValue("");
    await expect(
      form.getByLabel(zh ? "描述" : "Description", { exact: true }),
    ).toHaveValue("  Synthetic unsaved description  ");
    await expect(
      form.getByLabel(
        zh ? "别名，以英文逗号分隔" : "Aliases, comma separated",
        { exact: true },
      ),
    ).toHaveValue("  First alias, Second alias  ");
    await form
      .getByRole("button", {
        name: zh ? "保存项目" : "Save project",
        exact: true,
      })
      .click();
    await expect(form).toBeVisible();
    await form
      .getByLabel(zh ? "项目名称" : "Project name", { exact: true })
      .fill("Atlas Customer Portal");
    await form
      .getByRole("button", {
        name: zh ? "保存项目" : "Save project",
        exact: true,
      })
      .click();
    await expect(form).toHaveCount(0);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
    );
    expect(
      saved.projects.find((p: { id: string }) => p.id === "project-1"),
    ).toMatchObject({
      version: 2,
      description: "  Synthetic unsaved description  ",
      aliases: ["First alias", "Second alias"],
    });
    await page.reload();
    await page
      .getByRole("button", {
        name: zh ? "编辑项目" : "Edit project",
        exact: true,
      })
      .click();
    await expect(form.locator(".editor-draft-notice")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });

test("task and new subtask drafts stay separate by project and parent; cancellation removes them", async ({
  page,
}) => {
  await page.goto("/demo/projects/project-1");
  const title = await page
    .locator(".task-row:not(.parent) .task-title-line .text-button")
    .first()
    .innerText();
  await page
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
  const form = page.getByRole("form", { name: "Task editor", exact: true });
  await form
    .getByLabel("Task title", { exact: true })
    .fill("Synthetic task edit draft");
  await reloadDirty(page);
  await page
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
  await form
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(form.getByLabel("Task title", { exact: true })).toHaveValue(
    "Synthetic task edit draft",
  );
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
  await expect(form.locator(".editor-draft-notice")).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: `Add subtask to ${title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await form
    .getByLabel("Task title", { exact: true })
    .fill("Synthetic child draft");
  await reloadDirty(page);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(form.locator(".editor-draft-notice")).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/demo/projects/project-2");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(form.locator(".editor-draft-notice")).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/demo/projects/project-1");
  await page
    .getByRole("button", { name: `Add subtask to ${title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await form
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(form.getByLabel("Task title", { exact: true })).toHaveValue(
    "Synthetic child draft",
  );
  await form.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Synthetic child draft", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("project-manage-editor-drafts-v1:"),
        ).length,
    ),
  ).toBe(0);
});

test("inline notes keep exact table text across route return and continue drafting after a save", async ({
  page,
}) => {
  await page.goto("/demo/projects/project-1#source-records");
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  const notes = page.getByLabel("Original notes for Atlas Customer Portal", {
    exact: true,
  });
  const text = "  Synthetic note  \nItem\tValue\nSource\tKept exactly";
  await notes.fill(text);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page
    .getByRole("link", { name: "Atlas Customer Portal", exact: true })
    .click();
  await page.locator(".source-records > summary").click();
  await page
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(notes).toHaveValue(text);
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  await notes.fill(text + "\nSecond unsaved pass");
  await reloadDirty(page);
  await page.locator(".source-records > summary").click();
  await page
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(notes).toHaveValue(text + "\nSecond unsaved pass");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel notes", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(page.locator(".notes-reading")).toContainText("Synthetic note");
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  await expect(notes).toHaveValue(text);
});

test("a changed project keeps its old draft read-only and discard loads the latest version", async ({
  page,
}) => {
  await page.goto("/demo/projects/project-1");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const form = projectForm(page);
  await form
    .getByLabel("Description", { exact: true })
    .fill("Older unsaved draft");
  await page.evaluate(() => {
    const key = "project-manage-demo-v1",
      s = JSON.parse(localStorage.getItem(key)!);
    const p = s.projects.find((p: { id: string }) => p.id === "project-1");
    p.version++;
    p.description = "Newer synthetic saved version";
    s.revision++;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await reloadDirty(page);
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await form
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    "older draft stays read-only",
  );
  await expect(
    form.getByRole("button", { name: "Save project", exact: true }),
  ).toBeDisabled();
  await form.getByText("View saved draft contents", { exact: true }).click();
  await expect(form.locator(".editor-draft-notice pre")).toContainText(
    "Older unsaved draft",
  );
  await page.screenshot({
    path: "artifacts/personal-work/draft-version-conflict.png",
    fullPage: true,
  });
  await form
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(form.getByLabel("Description", { exact: true })).toHaveValue(
    "Newer synthetic saved version",
  );
  await expect(form.getByLabel("Description", { exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("project-manage-editor-drafts-v1:"),
        ).length,
    ),
  ).toBe(0);
});

test("expired-session editor drafts do not leak across accounts and explicit logout clears only the owner", async ({
  page,
}) => {
  await scenarioLogin(page, "data/e2e-login.json");
  await page.goto("/projects/project-1");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await projectForm(page)
    .getByLabel("Description", { exact: true })
    .fill("Private synthetic owner draft");
  expectedErrors.add("/api/workspace");
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic expired session" }),
    }),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.unroute("**/api/workspace");
  await scenarioLogin(page, "data/e2e-admin-login.json");
  await page.goto("/projects/project-1");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(projectForm(page).locator(".editor-draft-notice")).toHaveCount(
    0,
  );
  await projectForm(page)
    .getByLabel("Description", { exact: true })
    .fill("Administrator temporary draft");
  page.once("dialog", (d) => d.accept());
  await projectForm(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("project-manage-editor-drafts-v1:"),
          ).length,
      ),
    )
    .toBe(1);
  await scenarioLogin(page, "data/e2e-login.json");
  await page.goto("/projects/project-1");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  expectedErrors.add("/api/workspace");
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic unavailable" }),
    }),
  );
  await projectForm(page)
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(projectForm(page).getByRole("alert")).toContainText("retry");
  await expect(
    projectForm(page).getByRole("button", {
      name: "Save project",
      exact: true,
    }),
  ).toBeDisabled();
  await page.unroute("**/api/workspace");
  // A newer refresh may supersede the recovery request. Its discarded response
  // must not approve restoration just because the old in-memory version matches.
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/workspace", async (route) => {
    const index = ++requests;
    const response = await route.fetch();
    if (index === 1) await gate;
    await route.fulfill({ response });
  });
  try {
    const checking = page.waitForRequest("**/api/workspace");
    await projectForm(page)
      .getByRole("button", { name: "Check and restore draft", exact: true })
      .click();
    await checking;
    const newer = page.waitForResponse("**/api/workspace");
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await newer;
  } finally {
    release();
  }
  await expect(projectForm(page).getByRole("alert")).toContainText("retry");
  await expect(
    projectForm(page).getByLabel("Description", { exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/workspace");
  await projectForm(page)
    .getByRole("button", { name: "Check and restore draft", exact: true })
    .click();
  await expect(
    projectForm(page).getByLabel("Description", { exact: true }),
  ).toHaveValue("Private synthetic owner draft");
  page.once("dialog", (d) => d.accept());
  await projectForm(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("project-manage-editor-drafts-v1:"),
          ).length,
      ),
    )
    .toBe(0);
});

for (const responseMode of ["aborted response", "unreadable 400"] as const)
  test(`an uncertain creation ${responseMode} cannot turn a recovered draft into a duplicate write`, async ({
    page,
  }) => {
    await scenarioLogin(page, "data/e2e-login.json");
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    const form = projectForm(page),
      name = `Synthetic uncertain creation ${Date.now()}`;
    await form.getByLabel("Project name", { exact: true }).fill(name);
    let writes = 0;
    expectedErrors.add("/api/projects");
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writes++;
      await route.fetch();
      if (responseMode === "aborted response") await route.abort("failed");
      else
        await route.fulfill({
          status: 400,
          contentType: "text/html",
          body: "<html>Synthetic proxy response</html>",
        });
    });
    await form
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      responseMode === "aborted response"
        ? "Unable to reach"
        : "unreadable response",
    );
    await page.unroute("**/api/projects");
    await reloadDirty(page);
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await form
      .getByRole("button", { name: "Check and restore draft", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "avoid duplicate creation",
    );
    await expect(
      form.getByRole("button", { name: "Save project", exact: true }),
    ).toBeDisabled();
    const snapshot = await (await page.request.get("/api/workspace")).json();
    expect(
      snapshot.projects.filter((p: { name: string }) => p.name === name),
    ).toHaveLength(1);
    expect(writes).toBe(1);
    await form
      .getByRole("button", { name: "Discard draft", exact: true })
      .click();
    await expect(form.getByLabel("Project name", { exact: true })).toHaveValue(
      "",
    );
  });

test("failed local cleanup is reported after a successful sign-out without exposing draft contents", async ({
  page,
}) => {
  await scenarioLogin(page, "data/e2e-login.json");
  await page.goto("/projects/project-1");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await projectForm(page)
    .getByLabel("Description", { exact: true })
    .fill("Private synthetic cleanup draft");
  await expect(projectForm(page).getByRole("status")).toContainText(
    "Unsubmitted edits kept in this tab",
  );
  await reloadDirty(page);
  await page.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (
        this === sessionStorage &&
        key.startsWith("project-manage-editor-drafts-v1:")
      )
        throw new DOMException("Synthetic blocked cleanup", "SecurityError");
      return original.call(this, key);
    };
  });
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "You are signed out, but this browser could not clear your editor drafts",
  );
  await expect(
    page.getByText("Private synthetic cleanup draft", { exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
});
