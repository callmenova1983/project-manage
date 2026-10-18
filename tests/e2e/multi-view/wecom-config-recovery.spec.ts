import { test, expect } from "@playwright/test";
import { resetWorkspace } from "./support";

test("WeCom configuration refreshes a rejected request token once while preserving the draft", async ({
  page,
}, testInfo) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({
      json: { ...session, actor: { ...session.actor, role: "admin" } },
    });
  });
  let writes = 0;
  const keys: string[] = [],
    bodies: string[] = [];
  await page.route("**/api/directory/wecom/config", (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({
        json: {
          version: 0,
          corpId: "synthetic-corp",
          secretConfigured: false,
          source: "none",
        },
      });
    writes++;
    keys.push(request.headers()["idempotency-key"]!);
    bodies.push(request.postData()!);
    return writes === 1
      ? route.fulfill({
          status: 403,
          json: { message: "Invalid request token" },
        })
      : route.fulfill({
          json: {
            version: 1,
            corpId: "synthetic-corp",
            secretConfigured: true,
            source: "workspace",
          },
        });
  });
  let syncs = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/directory/wecom/sync")) syncs++;
  });
  await page.goto("/directory");
  await page
    .getByRole("button", {
      name: /企业微信配置|WeCom configuration/,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: /企业微信配置|WeCom configuration/,
  });
  await dialog
    .getByRole("textbox", {
      name: /通讯录 Secret|Directory secret/,
      exact: true,
    })
    .fill("synthetic-secret-for-recovery");
  await dialog
    .getByRole("button", { name: /保存配置|Save configuration/, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(writes).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(bodies[0]).toBe(bodies[1]);
  expect(syncs).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("config-saved.png"),
    fullPage: true,
  });
});

test("a second token rejection keeps configuration inputs available for manual retry", async ({
  page,
}, testInfo) => {
  await resetWorkspace(page, { language: "zh", theme: "light" });
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({
      json: { ...session, actor: { ...session.actor, role: "admin" } },
    });
  });
  let writes = 0;
  await page.route("**/api/directory/wecom/config", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          version: 0,
          corpId: "synthetic-corp",
          secretConfigured: false,
          source: "none",
        },
      });
    writes++;
    return route.fulfill({
      status: 403,
      json: { message: "Invalid request token" },
    });
  });
  await page.goto("/directory");
  await page
    .getByRole("button", {
      name: /企业微信配置|WeCom configuration/,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: /企业微信配置|WeCom configuration/,
  });
  const secret = dialog.getByRole("textbox", {
    name: /通讯录 Secret|Directory secret/,
    exact: true,
  });
  await secret.fill("synthetic-retained-secret");
  await dialog
    .getByRole("button", { name: /保存配置|Save configuration/, exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(secret).toHaveValue("synthetic-retained-secret");
  await expect(
    dialog.getByRole("textbox", {
      name: /企业 ID（CorpID）|Company ID/,
      exact: true,
    }),
  ).toHaveValue("synthetic-corp");
  await expect(
    dialog.getByRole("button", {
      name: /保存配置|Save configuration/,
      exact: true,
    }),
  ).toBeEnabled();
  expect(writes).toBe(2);
  await page.screenshot({
    path: testInfo.outputPath("retained-draft.png"),
    fullPage: false,
  });
});
