// Isolated browser replay of the observed proxy rewrite; no live Codespace,
// user browser, external service, real password or persistent database is used.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { buildApp } from "../dist/server/apps/api/src/app.js";
import { createUser } from "../dist/server/apps/api/src/auth.js";
import { configuredCodespacesRewrite } from "../dist/server/apps/api/src/origin.js";

const publicOrigin = "https://synthetic-space-3001.app.github.dev";
const { app, repo } = await buildApp({
  databasePath: ":memory:",
  origin: publicOrigin,
  production: true,
  codespacesOriginRewrite: configuredCodespacesRewrite(
    {
      CODESPACES_ORIGIN_REWRITE: "1",
      CODESPACES: "true",
      CODESPACE_NAME: "synthetic-space",
      PORT: "3001",
      HOST: "127.0.0.1",
    },
    publicOrigin,
  ),
});
repo.seed("synthetic");
const password = randomBytes(24).toString("hex");
await createUser(repo, {
  email: "proxy-browser@example.test",
  password,
  name: "Synthetic Member",
  workspaceId: "synthetic",
});
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  const errors = [],
    logins = [];
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== publicOrigin) {
      errors.push("Unexpected external request");
      await route.abort();
      return;
    }
    const browserHeaders = await request.allHeaders();
    const headers = {
      ...browserHeaders,
      host: "localhost:3001",
      "x-forwarded-host": new URL(publicOrigin).host,
      "x-forwarded-proto": "https",
    };
    if (headers.origin) headers.origin = "http://localhost:3001";
    if (url.pathname === "/api/auth/login")
      logins.push({
        origin: browserHeaders.origin,
        referer: browserHeaders.referer,
        fetchSite: browserHeaders["sec-fetch-site"],
      });
    const response = await app.inject({
      method: request.method(),
      url: url.pathname + url.search,
      headers,
      payload: request.postDataBuffer() ?? undefined,
      remoteAddress: "127.0.0.1",
    });
    const responseHeaders = {};
    for (const [key, value] of Object.entries(response.headers))
      if (value !== undefined && key !== "content-length")
        responseHeaders[key] = Array.isArray(value)
          ? value.join("\n")
          : String(value);
    await route.fulfill({
      status: response.statusCode,
      headers: responseHeaders,
      body: response.rawPayload,
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401"))
      errors.push(message.text());
  });
  await page.goto(publicOrigin + "/projects");
  await page
    .getByLabel("Email", { exact: true })
    .fill("proxy-browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Projects 20", exact: true })
    .waitFor();
  assert.equal(logins.length, 1);
  assert.equal(logins[0].origin, publicOrigin);
  assert.equal(new URL(logins[0].referer).origin, publicOrigin);
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page
    .getByLabel("Latest reported update", { exact: true })
    .fill("Synthetic browser proxy regression passed");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Project updated" })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  assert.equal(
    await page
      .getByLabel("Latest reported update", { exact: true })
      .inputValue(),
    "Synthetic browser proxy regression passed",
  );
  assert.deepEqual(errors, []);
  const result = {
    simulatedProxy: "passed",
    actualBrowserReferer: "passed",
    secureSession: "passed",
    csrfProtectedSaveReload: "passed",
    unexpectedErrors: 0,
    liveDeploymentTested: false,
  };
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/codespaces-browser.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  await app.close();
}
