import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSeed } from "../../packages/domain/seed";
import { projectInput } from "../../packages/domain/types";

test("independent members resume shared data and preserve dirty edits on mobile", async ({
  browser,
}) => {
  const first = await browser.newContext({
    viewport: { width: 1536, height: 1024 },
  });
  const second = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const errors: string[] = [];
  let conflictPath = "";
  function observe(page: Page) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const expected =
        message.text().includes("status of 409") &&
        new URL(message.location().url || "/", "http://localhost").pathname ===
          conflictPath;
      if (message.type() === "error" && !expected) errors.push(message.text());
    });
  }
  try {
    const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
    const otherCredentials = JSON.parse(
      readFileSync("data/e2e-admin-login.json", "utf8"),
    );
    const login = await first.request.post("/api/auth/login", {
      data: credentials,
    });
    expect(login.ok()).toBe(true);
    const a = await login.json();
    const other = await second.request.post("/api/auth/login", {
      data: otherCredentials,
    });
    expect(other.ok()).toBe(true);
    expect((await other.json()).actor.id).not.toBe(a.actor.id);
    const name = `Synthetic shared entry ${randomUUID().slice(0, 8)}`;
    const created = await first.request.post("/api/projects", {
      headers: { "x-csrf-token": a.csrf, "idempotency-key": randomUUID() },
      data: {
        ...projectInput.strip().parse(createSeed().projects[0]),
        name,
        description: "Synthetic multi-session recovery test",
        latestUpdate: "Shared workspace verification",
        aliases: [],
        notes: "Initial shared note",
      },
    });
    expect(created.status()).toBe(200);
    const project = await created.json();
    const desktop = await first.newPage(),
      mobile = await second.newPage();
    observe(desktop);
    observe(mobile);
    for (const page of [desktop, mobile]) {
      await page.goto("/projects");
      await page.getByLabel("Search projects", { exact: true }).fill(name);
      await page
        .getByRole("button", { name: `Expand ${name}`, exact: true })
        .click();
    }
    const firstNotes = desktop.getByLabel(`Original notes for ${name}`);
    const secondNotes = mobile.getByLabel(`Original notes for ${name}`);
    await firstNotes.fill("Saved by the first member");
    await desktop
      .getByRole("button", { name: "Save notes", exact: true })
      .click();
    await expect(
      desktop.getByRole("button", { name: "Save notes", exact: true }),
    ).toHaveCount(0);
    const resumed = mobile.waitForResponse(
      (response) => response.url().endsWith("/api/workspace") && response.ok(),
    );
    await mobile.evaluate(() => window.dispatchEvent(new Event("online")));
    await resumed;
    await expect(secondNotes).toHaveValue("Saved by the first member");
    await secondNotes.fill("Second member's unsaved text");
    await firstNotes.fill("Newer shared note");
    await desktop
      .getByRole("button", { name: "Save notes", exact: true })
      .click();
    await expect(
      desktop.getByRole("button", { name: "Save notes", exact: true }),
    ).toHaveCount(0);
    const visible = mobile.waitForResponse(
      (response) => response.url().endsWith("/api/workspace") && response.ok(),
    );
    await mobile.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await visible;
    await expect(secondNotes).toHaveValue("Second member's unsaved text");
    conflictPath = `/api/projects/${project.id}`;
    await mobile
      .getByRole("button", { name: "Save notes", exact: true })
      .click();
    await expect(mobile.getByRole("alert")).toContainText(
      "This record changed",
    );
    await expect(secondNotes).toHaveValue("Second member's unsaved text");
    expect((await (await first.request.get(conflictPath)).json()).notes).toBe(
      "Newer shared note",
    );
    mkdirSync("artifacts/runtime-recovery", { recursive: true });
    await mobile.screenshot({
      path: "artifacts/runtime-recovery/shared-conflict-mobile.png",
      fullPage: true,
    });
    await mobile
      .getByRole("button", { name: "Load latest version", exact: true })
      .click();
    await expect(secondNotes).toHaveValue("Newer shared note");
    await mobile.reload();
    await mobile
      .getByRole("button", { name: `Expand ${name}`, exact: true })
      .click();
    await expect(secondNotes).toHaveValue("Newer shared note");
    expect(errors).toEqual([]);
  } finally {
    await first.close();
    await second.close();
  }
});

test("document remains readable when JavaScript never starts", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: "Opening Project Manage" }),
    ).toBeVisible();
    // Playwright's text engine excludes noscript, though Chromium renders it.
    expect(await page.locator("noscript").textContent()).toContain(
      "JavaScript is required.",
    );
    const reload = page.getByRole("link", { name: "Reload page / 重新加载" });
    await reload.focus();
    await expect(reload).toBeFocused();
    mkdirSync("artifacts/runtime-recovery", { recursive: true });
    await page.screenshot({
      path: "artifacts/runtime-recovery/entry-no-script-mobile.png",
    });
    await reload.click();
    await expect(
      page.getByRole("heading", { name: "Opening Project Manage" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("failed entry module keeps a native reload link that recovers the login page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const path = new URL(message.location().url || "/", "http://localhost")
      .pathname;
    const expected =
      (path === "/src/main.ts" && message.text().includes("ERR_FAILED")) ||
      (path === "/api/auth/session" &&
        message.text().includes("status of 401"));
    if (message.type() === "error" && !expected) errors.push(message.text());
  });
  const entryModule = (url: URL) => url.pathname === "/src/main.ts";
  let blocked = 0;
  await page.route(entryModule, (route) => {
    blocked++;
    return route.abort("failed");
  });
  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "Opening Project Manage" }),
  ).toBeVisible();
  expect(blocked).toBeGreaterThan(0);
  await page.unroute(entryModule);
  await page.getByRole("link", { name: "Reload page / 重新加载" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reload page / 重新加载" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
