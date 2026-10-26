import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import type { Proposal } from "../../packages/domain/types.js";
test.beforeEach(async ({ page }) => {
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  expect(
    (await page.request.post("/api/auth/login", { data: credentials })).ok(),
  ).toBe(true);
  await page.route("**/api/ai/capabilities", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        provider: "qwen",
        model: "qwen3.6-35b-a3b",
        region: "cn-beijing",
        connectionVerified: false,
        remainingAttempts: 3,
      },
    }),
  );
});
test("mock Qwen review requires external consent, explicit project selection and overwrite confirmation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await (await page.request.get("/api/workspace")).json();
  const project = state.projects[0];
  const source = "Atlas: synthetic acceptance complete";
  let sent = 0,
    applied = 0;
  const proposal: Proposal = {
    id: "synthetic-qwen-proposal",
    source,
    sourceVersion: 1,
    status: "draft",
    createdAt: new Date().toISOString(),
    generator: {
      provider: "qwen",
      model: "qwen3.6-35b-a3b",
      region: "cn-beijing",
      promptVersion: 1,
    },
    suggestions: [
      {
        id: "synthetic-item",
        sourceLine: 1,
        sourceText: source,
        title: "Synthetic acceptance complete",
        candidates: [
          {
            projectId: project.id,
            reason: "Synthetic model candidate for contract testing",
          },
        ],
        selectedProjectId: "",
        action: "update",
        status: "done",
        confirmed: false,
        overwriteConfirmed: false,
      },
    ],
  };
  await page.route("**/api/proposals/qwen", async (route) => {
    sent++;
    expect(route.request().postDataJSON()).toEqual({
      source,
      externalProcessingConfirmed: true,
    });
    await route.fulfill({ json: proposal });
  });
  await page.route(
    "**/api/proposals/synthetic-qwen-proposal/apply",
    async (route) => {
      applied++;
      expect(route.request().postDataJSON().suggestions[0]).toMatchObject({
        selectedProjectId: project.id,
        confirmed: true,
        overwriteConfirmed: true,
        projectVersion: project.version,
      });
      await route.fulfill({ json: { ...proposal, status: "applied" } });
    },
  );
  await page.goto("/meetings");
  await expect(
    page.getByText("Rule-assisted review · AI is not connected", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Review method").selectOption("qwen");
  await page.getByLabel("Meeting notes", { exact: true }).fill(source);
  const review = page.getByRole("button", { name: "Review suggestions" });
  await expect(review).toBeDisabled();
  expect(sent).toBe(0);
  await page
    .getByRole("checkbox", { name: /I approve sending these notes/ })
    .check();
  await review.click();
  await expect(
    page.getByText("Qwen-generated suggestions · human review required"),
  ).toBeVisible();
  expect(sent).toBe(1);
  expect(applied).toBe(0);
  await expect(page.getByLabel("Project for suggestion 1")).toHaveValue("");
  await page.getByLabel("Confirm suggestion 1").check();
  await expect(
    page.getByRole("button", { name: "Apply 1 confirmed changes" }),
  ).toBeDisabled();
  await page.getByLabel("Project for suggestion 1").selectOption(project.id);
  await expect(
    page.getByRole("button", { name: "Apply 1 confirmed changes" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I reviewed and confirm replacing this update",
    })
    .check();
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/qwen-mock-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Apply 1 confirmed changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Reviewed and recorded" }),
  ).toBeVisible();
  expect(applied).toBe(1);
  expect(errors).toEqual([]);
});
test("mock Qwen failure retains notes and supports explicit rule-assisted fallback on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/proposals/qwen", (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "AI_PROVIDER",
        message: "Synthetic provider unavailable. Nothing was applied.",
      },
    }),
  );
  await page.goto("/meetings");
  await page.getByLabel("Review method").selectOption("qwen");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/qwen-mock-mobile.png",
    fullPage: true,
  });
  await page
    .getByLabel("Meeting notes", { exact: true })
    .fill("Atlas: synthetic retry review");
  await page
    .getByRole("checkbox", { name: /I approve sending these notes/ })
    .check();
  await page
    .getByLabel("Meeting notes", { exact: true })
    .fill("Atlas: synthetic updated review");
  await expect(
    page.getByRole("checkbox", { name: /I approve sending these notes/ }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: /I approve sending these notes/ })
    .check();
  await page.getByRole("button", { name: "Review suggestions" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic provider unavailable",
  );
  await expect(page.getByLabel("Meeting notes", { exact: true })).toHaveValue(
    "Atlas: synthetic updated review",
  );
  await page.getByLabel("Review method").selectOption("rules");
  await page.getByRole("button", { name: "Review suggestions" }).click();
  await expect(page.locator(".suggestion-card")).toHaveCount(1);
  await expect(
    page.getByText("Rule-assisted review · AI is not connected", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel review" }).click();
  await expect(page.getByLabel("Meeting notes", { exact: true })).toHaveValue(
    "",
  );
  expect(errors).toEqual([]);
});
