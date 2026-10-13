import { test, expect, type Cookie, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSeed } from "../../packages/domain/seed";
let cookies: Cookie[] = [],
  csrf = "";
const errors: string[] = [];
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function menu(page: Page, label: string) {
  await page.getByRole("button", { name: "Toggle sidebar" }).tap();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: label, exact: true })
    .tap();
}
for (const width of [375, 390]) {
  test.describe(`mobile ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    test.beforeEach(async ({ page }) => {
      errors.length = 0;
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      if (!cookies.length) {
        const credentials = JSON.parse(
          readFileSync("data/e2e-login.json", "utf8"),
        );
        const login = await page.request.post("/api/auth/login", {
          data: credentials,
        });
        expect(login.ok()).toBe(true);
        csrf = (await login.json()).csrf;
        cookies = await page.context().cookies();
      } else await page.context().addCookies(cookies);
      const current = await (await page.request.get("/api/workspace")).json();
      const restored = await page.request.post("/api/import", {
        headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
        data: { ...createSeed(), revision: current.revision, confirmed: true },
      });
      expect(restored.ok()).toBe(true);
      await page.goto("/projects");
      await expect(
        page.getByRole("heading", { name: "Projects 20", exact: true }),
      ).toBeVisible();
    });
    test.afterEach(() => expect(errors).toEqual([]));
    test("facts, named scope tasks, filters, touch targets and route return", async ({
      page,
    }) => {
      const first = page.locator(".project-record").first();
      await expect(first.locator(".latest-update")).toContainText(
        "Alex Morgan",
      );
      await expect(first.locator(".project-week")).toContainText(
        "Confirm project scope",
      );
      const meridian = page.locator(".project-record").nth(1);
      await page.getByRole("button", { name: "Today 8", exact: true }).tap();
      await expect(meridian.locator(".project-week")).toContainText(
        "No work planned",
      );
      await page
        .getByRole("button", { name: "This week 24", exact: true })
        .tap();
      await expect(meridian.locator(".project-week")).toContainText(
        "Confirm project scope",
      );
      for (const name of [
        "Toggle sidebar",
        "New project",
        "Expand Atlas Customer Portal",
      ]) {
        const box = await page
          .getByRole("button", { name, exact: true })
          .boundingBox();
        expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
      }
      await page.getByLabel("Search projects").fill("Atlas");
      await page.getByLabel("Filter by stage").selectOption("implementation");
      await expect(page.locator(".project-record")).toHaveCount(1);
      await page
        .getByRole("link", { name: "Atlas Customer Portal", exact: true })
        .tap();
      await expect(
        page.getByRole("heading", {
          name: "Atlas Customer Portal",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("link", { name: "All projects", exact: true }).tap();
      await noOverflow(page);
      await menu(page, "Activity");
      await expect(
        page.getByRole("heading", { name: "Activity", exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/projects$/);
      mkdirSync("artifacts", { recursive: true });
      await page.screenshot({ path: `artifacts/mobile-${width}-projects.png` });
    });
    test("inline long notes save, cancel, reduced-height scrolling and menu overlay", async ({
      page,
    }) => {
      await page.goto("/projects/project-1#source-records");
      await page.getByRole("button", { name: "Edit notes", exact: true }).tap();
      const notes = page.getByRole("textbox", {
        name: "Original notes for Atlas Customer Portal",
      });
      const original = await notes.inputValue();
      await notes.fill("Temporary note");
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Cancel notes", exact: true })
        .tap();
      await page.getByRole("button", { name: "Edit notes", exact: true }).tap();
      await expect(notes).toHaveValue(original);
      const long =
        "Synthetic long note ✓\n" +
        "Review work and acceptance context. ".repeat(45) +
        "\nDecision\tOwner\tConfirmed";
      await notes.fill(long);
      // Reduced visual space is a layout test, not an emulated iOS software keyboard.
      await page.setViewportSize({ width, height: 440 });
      await notes.focus();
      const save = page.getByRole("button", {
        name: "Save notes",
        exact: true,
      });
      await save.scrollIntoViewIfNeeded();
      const rect = await save.boundingBox();
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(441);
      await save.tap();
      await expect(page.getByRole("status")).toContainText("Project updated");
      await noOverflow(page);
      await page.reload();
      await page.goto("/projects/project-1#source-records");
      await page.getByRole("button", { name: "Edit notes", exact: true }).tap();
      await expect(notes).toHaveValue(long);
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("button", { name: "Toggle sidebar" }).tap();
      await expect(
        page.getByRole("dialog", { name: "Workspace menu" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close sidebar" }).tap();
      await expect(
        page.getByRole("dialog", { name: "Workspace menu" }),
      ).not.toBeVisible();
      await noOverflow(page);
    });
    test("daily tasks, task and subtask creation, state change, cancellation and reload", async ({
      page,
    }) => {
      await menu(page, "All tasks");
      await page.getByRole("button", { name: "Today 8", exact: true }).tap();
      await expect(page.locator(".task-row")).toHaveCount(8);
      await page
        .getByRole("button", { name: "This week 24", exact: true })
        .tap();
      await expect(page.locator(".task-row")).toHaveCount(24);
      await page.getByLabel("Filter task project").selectOption("project-1");
      await expect(page.locator(".task-row")).toHaveCount(8);
      await page
        .getByRole("button", {
          name: "Edit Confirm project scope",
          exact: true,
        })
        .tap();
      await page
        .getByLabel("Task title", { exact: true })
        .fill("Cancelled title");
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Cancel", exact: true }).tap();
      await expect(
        page.getByRole("button", {
          name: "Confirm project scope",
          exact: true,
        }),
      ).toBeVisible();
      await menu(page, "Projects");
      await page
        .getByRole("link", { name: "Atlas Customer Portal", exact: true })
        .tap();
      await page.getByRole("button", { name: "Add task", exact: true }).tap();
      const title =
        "Mobile acceptance: verify the full workflow and handoff on a small screen";
      await page.getByLabel("Task title", { exact: true }).fill(title);
      await page.getByRole("button", { name: "Save task", exact: true }).tap();
      await page
        .getByRole("button", { name: `Add subtask to ${title}`, exact: true })
        .tap();
      await page
        .getByLabel("Task title", { exact: true })
        .fill("Mobile child acceptance");
      await page.getByRole("button", { name: "Save task", exact: true }).tap();
      await page
        .getByLabel("Status for Mobile child acceptance", { exact: true })
        .selectOption("done");
      await expect(
        page.getByText("1/1 subtasks completed", { exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      await page.reload();
      await expect(
        page.getByLabel("Status for Mobile child acceptance", { exact: true }),
      ).toHaveValue("done");
      await page.screenshot({
        path: `artifacts/mobile-${width}-task-workflow.png`,
        fullPage: true,
      });
    });
    test("meeting ambiguity, source review, overwrite confirmation and cancellation", async ({
      page,
    }) => {
      await page
        .getByRole("link", { name: "Review meeting notes", exact: true })
        .tap();
      await page
        .getByRole("textbox", { name: "Meeting notes", exact: true })
        .fill("Atlas and Meridian: mobile review completed ✓");
      await page
        .getByRole("button", { name: "Review suggestions", exact: true })
        .tap();
      await expect(page.getByText(/Ambiguous:/)).toBeVisible();
      await page
        .getByLabel("Project for suggestion 1")
        .selectOption("project-1");
      await page.getByLabel("Action for suggestion 1").selectOption("update");
      await page.getByLabel("Confirm suggestion 1").check();
      await expect(
        page.getByRole("button", { name: "Apply 1 confirmed changes" }),
      ).toBeDisabled();
      await page
        .getByLabel("I reviewed and confirm replacing this update")
        .check();
      await page
        .getByRole("button", { name: "Apply 1 confirmed changes" })
        .tap();
      await expect(
        page.getByRole("heading", { name: "Reviewed and recorded" }),
      ).toBeVisible();
      await noOverflow(page);
      await page.getByRole("button", { name: "Review more notes" }).tap();
      await page
        .getByRole("textbox", { name: "Meeting notes", exact: true })
        .fill("Atlas: unsaved suggestion");
      await page
        .getByRole("button", { name: "Review suggestions", exact: true })
        .tap();
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Cancel review", exact: true })
        .tap();
      await expect(
        page.getByRole("textbox", { name: "Meeting notes", exact: true }),
      ).toHaveValue("");
    });
  });
}
