import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
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
test("configured AI records unambiguous progress with one click and no replacement form", async ({
  page,
}) => {
  const project = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
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
          { projectId: project.id, reason: "Synthetic model candidate" },
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
      expect(route.request().postDataJSON()).toMatchObject({
        partial: true,
        updateMode: "append",
        suggestions: [
          {
            selectedProjectId: project.id,
            confirmed: true,
            overwriteConfirmed: false,
          },
        ],
      });
      await route.fulfill({
        json: {
          ...proposal,
          status: "applied",
          appliedSuggestionIds: ["synthetic-item"],
        },
      });
    },
  );
  await page.goto("/meetings");
  await page.getByLabel("Meeting notes", { exact: true }).fill(source);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.getByText("已完成：记录 1 条进展。", { exact: true }),
  ).toBeVisible();
  expect(sent).toBe(1);
  expect(applied).toBe(1);
  await expect(page.locator(".meeting-conversation textarea")).toHaveCount(1);
  await expect(
    page.locator(
      ".meeting-conversation input, .meeting-conversation select, .suggestion-card",
    ),
  ).toHaveCount(0);
});
test("AI failure preserves source and completes rule-matched items on the same mobile page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/proposals/qwen", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "AI_PROVIDER", message: "Synthetic provider unavailable" },
    }),
  );
  await page.goto("/meetings");
  const source = "Atlas: synthetic fallback review";
  await page.getByLabel("Meeting notes", { exact: true }).fill(source);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.getByText("原文已保存；AI 整理未完成，本次按规则整理。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("已完成：新增 1 项任务。", { exact: true }),
  ).toBeVisible();
  expect(
    await page.locator(".meeting-message.user p").first().textContent(),
  ).toBe(source);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
