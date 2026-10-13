import { test, expect, type Cookie } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { scenarioLogin } from "./scenario-login";
import {
  defaultModelSettings,
  type ModelAdminState,
} from "../../packages/domain/admin";
let cookies: Cookie[];
test.beforeAll(async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
  });
  try {
    const page = await context.newPage();
    await scenarioLogin(page, "data/e2e-admin-login.json");
    const actual = await context.request.get("/api/admin/model");
    expect(actual.status()).toBe(200);
    expect(await actual.json()).toMatchObject({
      credentialAvailable: false,
      runtimeEnabled: false,
      remainingAttempts: 0,
      expiresAt: null,
    });
    cookies = await context.cookies();
  } finally {
    await context.close();
  }
});
for (const language of ["en", "zh-CN"])
  for (const theme of ["dark", "light"])
    for (const width of [1536, 390])
      test(`model reporting ${language} ${theme} ${width}: missing, failed, exhausted and expired`, async ({
        page,
        context,
      }) => {
        const zh = language === "zh-CN",
          errors: string[] = [],
          external: string[] = [];
        await context.addCookies(cookies);
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1024,
        });
        await page.addInitScript(
          ({ language, theme }) => {
            localStorage.setItem("project-manage-locale", language);
            localStorage.setItem("project-manage-theme", theme);
          },
          { language, theme },
        );
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        page.on("request", (r) => {
          if (new URL(r.url()).origin !== "http://127.0.0.1:4173")
            external.push(r.url());
        });
        let state: ModelAdminState = {
          settings: { ...defaultModelSettings },
          credentialAvailable: false,
          runtimeEnabled: false,
          approvedRegion: null,
          approvedModel: null,
          remainingAttempts: 0,
          expiresAt: null,
        };
        // Synthetic response fixtures exercise rendering only; real HTTP statistics have integration coverage.
        await page.route("**/api/admin/model", (route) =>
          route.fulfill({ json: state }),
        );
        await page.route("**/api/admin/model/logs", (route) =>
          route.fulfill({
            json: [
              {
                id: "synthetic-failed",
                createdAt: "2026-10-13T10:00:00Z",
                actor: "Synthetic reviewer",
                provider: "qwen",
                model: "qwen3.6-35b-a3b",
                mode: "real",
                status: "failed",
                durationMs: 40,
                inputTokens: 140,
                outputTokens: 2048,
                cost: null,
                errorCode: "AI_INVALID_OUTPUT",
                attempts: 1,
              },
              {
                id: "synthetic-pending",
                createdAt: "2026-10-13T09:00:00Z",
                actor: "Synthetic reviewer",
                provider: "qwen",
                model: "qwen3.6-35b-a3b",
                mode: "real",
                status: "started",
                durationMs: null,
                inputTokens: null,
                outputTokens: null,
                cost: null,
                errorCode: null,
                attempts: 1,
              },
              {
                id: "synthetic-rule",
                createdAt: "2026-10-13T08:00:00Z",
                actor: "Synthetic reviewer",
                provider: "rules",
                model: null,
                mode: "rules",
                status: "succeeded",
                durationMs: 1,
                inputTokens: null,
                outputTokens: null,
                cost: null,
                errorCode: null,
                attempts: 0,
              },
            ],
          }),
        );
        await page.goto("/admin");
        await page
          .getByRole("tab", {
            name: zh ? "模型设置" : "Model settings",
            exact: true,
          })
          .click();
        await expect(page.locator(".model-state")).toContainText(
          zh ? "尚未配置服务器凭证" : "Server credential not provisioned",
        );
        await expect(
          page.getByLabel(
            zh
              ? "允许用户明确确认后的外部请求"
              : "Allow explicitly confirmed external requests",
          ),
        ).toBeDisabled();
        state = {
          ...state,
          settings: {
            ...state.settings,
            enabled: true,
            secretRef: "server-default",
          },
          credentialAvailable: true,
          remainingAttempts: 0,
          approvedRegion: "cn-beijing",
          approvedModel: "qwen3.6-35b-a3b",
          expiresAt: "2099-01-01T00:00:00Z",
        };
        await page
          .getByRole("button", { name: zh ? "刷新" : "Refresh", exact: true })
          .click();
        await expect(page.locator(".model-state")).toContainText(
          zh ? "外部调用未启用" : "External calls disabled",
        );
        await expect(page.locator(".admin-editor")).toContainText(
          zh ? "剩余 0 次尝试" : "0 attempts remain",
        );
        state = {
          ...state,
          remainingAttempts: 3,
          expiresAt: "2020-01-01T00:00:00Z",
        };
        await page
          .getByRole("button", { name: zh ? "刷新" : "Refresh", exact: true })
          .click();
        await expect(page.locator(".admin-editor")).toContainText("2020");
        await expect(page.locator(".model-state")).toContainText(
          zh ? "外部调用未启用" : "External calls disabled",
        );
        await page
          .getByRole("tab", {
            name: zh ? "调用日志" : "Call logs",
            exact: true,
          })
          .click();
        await page
          .getByLabel(zh ? "日志类型" : "Log type")
          .selectOption("real");
        await expect(page.locator("tbody tr")).toHaveCount(2);
        const failed = page
          .locator("tbody tr")
          .filter({ hasText: "AI_INVALID_OUTPUT" });
        await expect(failed).toContainText(zh ? "失败" : "failed");
        await expect(failed).toContainText("140");
        await expect(failed).toContainText("2,048");
        await expect(failed).toContainText(zh ? "未知" : "Unknown");
        await expect(page.locator("tbody tr").nth(1)).toContainText("—");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        mkdirSync("artifacts/model-reporting", { recursive: true });
        await page.screenshot({
          path: `artifacts/model-reporting/${language}-${theme}-${width}.png`,
          fullPage: true,
        });
        if (width === 390) {
          const table = page.locator(".admin-table-scroll");
          await table.focus();
          for (let i = 0; i < 24; i++) await page.keyboard.press("ArrowRight");
          await expect
            .poll(() => table.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
          await page.screenshot({
            path: `artifacts/model-reporting/${language}-${theme}-${width}-scrolled.png`,
            fullPage: true,
          });
        }
        expect(errors).toEqual([]);
        expect(external).toEqual([]);
      });
