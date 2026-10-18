import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app";

it("public runtime chunks do not exhaust the API quota while API and login limits remain enforced", async () => {
  const root = mkdtempSync(join(tmpdir(), "pm-static-rate-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><title>Synthetic</title>",
  );
  writeFileSync(
    join(root, "assets/runtime.js"),
    "export const fixture = true;",
  );
  const context = await buildApp({
    databasePath: ":memory:",
    origin: "http://localhost:4189",
    staticPath: root,
  });
  try {
    for (let index = 0; index < 320; index++) {
      const asset = await context.app.inject({
        method: "GET",
        url: `/assets/runtime.js?sample=${index}`,
      });
      expect(asset.statusCode).toBe(200);
    }
    for (let index = 0; index < 300; index++)
      expect(
        (await context.app.inject({ method: "GET", url: "/api/health" }))
          .statusCode,
      ).toBe(200);
    const limited = await context.app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    for (let index = 0; index < 10; index++)
      expect(
        (
          await context.app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: {
              email: "absent@example.test",
              password: "synthetic-invalid-password",
            },
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "absent@example.test",
            password: "synthetic-invalid-password",
          },
        })
      ).statusCode,
    ).toBe(429);
    // A similar-looking API path is still protected by authentication.
    expect(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/assets/runtime.js",
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await context.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
