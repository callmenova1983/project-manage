import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { buildApp } from "../../apps/api/src/app";
const dir = mkdtempSync(join(tmpdir(), "pm-entry-"));
let app: Awaited<ReturnType<typeof buildApp>>["app"];
beforeAll(async () => {
  mkdirSync(join(dir, "assets"));
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html><body><div id="app" data-pm-entry="1">Opening Project Manage</div><script type="module" src="/assets/app-a1.js"></script></body></html>',
  );
  writeFileSync(
    join(dir, "assets/app-a1.js"),
    "export const synthetic = true;",
  );
  ({ app } = await buildApp({
    databasePath: ":memory:",
    origin: "https://workspace.example.test",
    production: true,
    staticPath: dir,
  }));
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});
it.each(["desktop", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"])(
  "serves nonempty inline HTML for document routes with %s",
  async (agent) => {
    for (const url of [
      "/",
      "/projects",
      "/projects/project-1",
      "/demo/projects",
      "/demo/intake?view=review",
    ]) {
      const response = await app.inject({
        url,
        headers: { accept: "text/html", "user-agent": agent },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["content-disposition"]).toBe("inline");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.body).toContain("data-pm-entry");
      expect(response.body.length).toBeGreaterThan(100);
    }
  },
);
it("keeps HEAD intentionally bodyless and reloading HTML unconditionally fresh", async () => {
  const response = await app.inject({ method: "HEAD", url: "/projects" });
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe("");
  expect(Number(response.headers["content-length"])).toBeGreaterThan(0);
  const reload = await app.inject({
    url: "/projects",
    headers: {
      "if-modified-since": new Date(Date.now() + 100000).toUTCString(),
    },
  });
  expect(reload.statusCode).toBe(200);
  expect(reload.body).toContain("Opening Project Manage");
});
it("never serves HTML for missing bundles, files, non-document requests or POST", async () => {
  for (const url of [
    "/assets/stale.js",
    "/assets/stale.css",
    "/assets/stale.woff2",
    "/missing.js",
    "/api",
  ]) {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).not.toContain("<html");
    expect(response.headers["cache-control"]).toBe("no-store");
  }
  expect(
    (
      await app.inject({
        url: "/projects",
        headers: { accept: "application/json" },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ method: "POST", url: "/projects" })).statusCode,
  ).toBe(404);
  const bundle = await app.inject({ url: "/assets/app-a1.js" });
  expect(bundle.statusCode).toBe(200);
  expect(bundle.headers["content-type"]).toMatch(/javascript/);
});
it("exposes only public health and retains private API authentication and no-store", async () => {
  expect(
    (await app.inject({ url: "/api/health?probe=mobile" })).json(),
  ).toEqual({ status: "ok" });
  const response = await app.inject({ url: "/api/workspace" });
  expect(response.statusCode).toBe(401);
  expect(response.headers["cache-control"]).toBe("no-store");
});
it("rejects an empty or incomplete web build before opening the database", async () => {
  const bad = join(dir, "incomplete");
  mkdirSync(bad);
  for (const empty of [false, true]) {
    if (empty) writeFileSync(join(bad, "index.html"), "");
    await expect(
      buildApp({
        databasePath: ":memory:",
        origin: "http://localhost",
        staticPath: bad,
      }),
    ).rejects.toThrow("missing or empty");
  }
});
it("refuses a production process without its built web entry", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("apps/api/src/index.ts"),
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_ORIGIN: "https://synthetic.example.test",
        DATABASE_PATH: join(dir, "never-open.sqlite"),
        AI_PROVIDER: "rules",
      },
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Production web build is missing");
});
