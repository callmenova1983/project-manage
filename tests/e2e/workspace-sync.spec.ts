import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

test("lightweight startup, two clients and fallback repair", async ({
  page,
  browser,
}) => {
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  const login = await page.request.post("/api/auth/login", {
    data: credentials,
  });
  expect(login.ok()).toBeTruthy();
  const csrf = (await login.json()).csrf;
  const paths: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/"))
      paths.push(new URL(request.url()).pathname);
  });
  await page.goto("/projects");
  await expect(page.locator(".project-record").first()).toBeVisible();
  expect(paths).toContain("/api/bootstrap");
  expect(paths).not.toContain("/api/workspace");
  expect(paths).not.toContain("/api/auth/session");
  expect(paths).not.toContain("/api/directory");
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const project = bootstrap.core.projects[0];
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
  try {
    await other.request.post("/api/auth/login", { data: credentials });
    const second = await other.newPage();
    await second.goto("/projects");
    await expect(second.locator(".project-record").first()).toBeVisible();
    const name = `Live collaboration ${randomUUID().slice(0, 8)}`;
    const start = Date.now();
    const saved = await page.request.put(`/api/projects/${project.id}/name`, {
      headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
      data: { name, version: project.version },
    });
    expect(saved.ok()).toBeTruthy();
    const acknowledged = Date.now();
    await expect(
      second.locator(".project-record").filter({ hasText: name }),
    ).toBeVisible({ timeout: 3000 });
    const visible = Date.now();
    // Disable this client's stream. The persistent metadata fallback must still repair changes.
    await second.route("**/api/workspace/events", (route) => route.abort());
    await second.reload();
    await expect(second.locator(".project-record").first()).toBeVisible();
    const next = await saved.json(),
      recoveredName = name + " repaired";
    const update = await page.request.put(`/api/projects/${project.id}/name`, {
      headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
      data: { name: recoveredName, version: next.version },
    });
    expect(update.ok()).toBeTruthy();
    await expect(
      second.locator(".project-record").filter({ hasText: recoveredName }),
    ).toBeVisible({ timeout: 5000 });
    const coreRequests = paths.filter(
      (path) => path === "/api/workspace/core",
    ).length;
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect
      .poll(() => paths.filter((path) => path === "/api/workspace/meta").length)
      .toBeGreaterThan(0);
    // A no-change calibration must not download the old full snapshot.
    expect(paths).not.toContain("/api/workspace");
    const searchStart = Date.now();
    await page
      .getByLabel("Search projects", { exact: true })
      .fill(recoveredName);
    await expect(page.locator(".project-record")).toHaveCount(1);
    const searchMs = Date.now() - searchStart;
    expect(errors).toEqual([]);
    await test.info().attach("local-sync-sample.json", {
      body: JSON.stringify(
        {
          saveMs: acknowledged - start,
          collaborationMs: visible - acknowledged,
          coreRequests,
          searchMs,
          network: "local unrestricted; one sample; not p95",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await other.close();
  }
});
