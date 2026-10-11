import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

async function navigate(page: Page, label: string) {
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: label, exact: true })
    .click();
}

for (const width of [1536, 390, 375]) {
  test.describe(`isolated browser demo ${width}px`, () => {
    test.use({
      viewport: { width, height: width === 1536 ? 1024 : 844 },
      hasTouch: width !== 1536,
    });
    test("opens anonymously, saves project and task edits across reload, and stays local", async ({
      page,
    }) => {
      const apiRequests: string[] = [],
        errors: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto("/demo/");
      await expect(page).toHaveURL(/\/demo\/projects$/);
      await expect(
        page.getByRole("heading", { name: "Projects 20", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".demo-notice")).toContainText(
        "synthetic projects",
      );
      await expect(page.locator(".demo-notice")).toContainText(
        "No shared backend or AI connection",
      );
      await expect(
        page.getByRole("button", { name: "Toggle sidebar" }),
      ).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".workspace-totals")).toContainText(
        "150 tasks",
      );
      await expect(page.locator(".workspace-totals")).toContainText(
        "90 completed",
      );
      await expect(
        page.getByRole("button", { name: "This week 24", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      mkdirSync("artifacts", { recursive: true });
      await page.screenshot({ path: `artifacts/demo-${width}.png` });
      const a11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(a11y.violations).toEqual([]);

      await page
        .getByRole("button", {
          name: "Expand Atlas Customer Portal",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Edit project", exact: true })
        .click();
      await page
        .getByLabel("Latest reported update", { exact: true })
        .fill("Synthetic demo update saved on this device.");
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText("Project updated");
      await page.reload();
      await page
        .getByRole("button", {
          name: "Expand Atlas Customer Portal",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Edit project", exact: true })
        .click();
      await expect(
        page.getByLabel("Latest reported update", { exact: true }),
      ).toHaveValue("Synthetic demo update saved on this device.");
      await page
        .getByLabel("Project name", { exact: true })
        .fill("Discarded demo title");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.getByRole("link", { name: "Atlas Customer Portal", exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Add task", exact: true }).click();
      await page
        .getByLabel("Task title", { exact: true })
        .fill("Synthetic demo recording task");
      await page.getByLabel("Today", { exact: true }).check();
      await page
        .getByRole("button", { name: "Save task", exact: true })
        .dblclick();
      await expect(
        page.getByRole("button", {
          name: "Synthetic demo recording task",
          exact: true,
        }),
      ).toHaveCount(1);
      await page
        .getByLabel("Status for Synthetic demo recording task")
        .selectOption("done");
      await expect(
        page.getByLabel("Status for Synthetic demo recording task"),
      ).toHaveValue("done");
      await page.reload();
      await page
        .getByRole("button", {
          name: "Expand Atlas Customer Portal",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel("Status for Synthetic demo recording task"),
      ).toHaveValue("done");
      await page
        .getByRole("link", { name: "Atlas Customer Portal", exact: true })
        .click();
      await expect(page).toHaveURL(/\/demo\/projects\/.+/);
      await page
        .getByRole("link", { name: "All projects", exact: true })
        .click();
      await expect(page).toHaveURL(/\/demo\/projects$/);
      await navigate(page, "All tasks");
      await expect(page).toHaveURL(/\/demo\/tasks$/);
      await page.getByRole("button", { name: /Today/ }).click();
      await expect(
        page.getByLabel("Status for Synthetic demo recording task"),
      ).toHaveValue("done");
      await navigate(page, "Meeting notes");
      await expect(page).toHaveURL(/\/demo\/meetings$/);
      await expect(page.getByLabel("Review method")).toHaveCount(0);
      await expect(page.getByText(/not model-generated/)).toBeVisible();
      await page
        .getByLabel("Meeting notes", { exact: true })
        .fill("Atlas: check the synthetic demo recording");
      await page
        .getByRole("button", { name: "Review suggestions", exact: true })
        .click();
      await expect(page.locator(".suggestion-card")).toHaveCount(1);
      expect(apiRequests).toEqual([]);
      expect(errors).toEqual([]);
      expect(
        (await page.context().cookies()).filter(
          (cookie) => cookie.name === "pm_session",
        ),
      ).toEqual([]);
    });
  });
}

test("demo entry never authenticates the formal workspace and unknown demo routes stay local", async ({
  page,
}) => {
  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Try demo · no sign-in required" })
    .click();
  await expect(page).toHaveURL(/\/demo\/projects$/);
  await expect(
    page.getByRole("heading", { name: "Projects 20", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/workspace")).status()).toBe(401);
  await page.goto("/demo/missing");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Return to projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\/projects$/);
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page
    .getByRole("link", { name: "Open shared workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect((await page.request.get("/api/workspace")).status()).toBe(401);
  expect(
    (await page.context().cookies()).filter(
      (cookie) => cookie.name === "pm_session",
    ),
  ).toEqual([]);
});
