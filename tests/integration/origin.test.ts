import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import {
  configuredAppOrigin,
  validateAppOrigin,
} from "../../apps/api/src/origin.js";
const publicOrigin =
  "https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev";
describe("explicit browser origin configuration", () => {
  it("canonicalizes only the configured origin and retains the local development default", () => {
    expect(validateAppOrigin(publicOrigin + "/")).toBe(publicOrigin);
    expect(validateAppOrigin(" HTTPS://EXAMPLE.TEST:443/ ")).toBe(
      "https://example.test",
    );
    expect(configuredAppOrigin({})).toBe("http://localhost:4173");
    expect(
      configuredAppOrigin({ NODE_ENV: "production", APP_ORIGIN: publicOrigin }),
    ).toBe(publicOrigin);
  });
  it.each([
    publicOrigin + "/projects",
    publicOrigin + "?x=1",
    publicOrigin + "#projects",
    "https://user:password@example.test",
    "https://*.app.github.dev",
    "https://one.test,https://two.test",
    "null",
    "*",
    "file:///tmp/test",
  ])(
    "rejects ambiguous or invalid configuration %# before serving login",
    (value) => {
      expect(() => validateAppOrigin(value)).toThrow("APP_ORIGIN");
    },
  );
  it("requires an explicit HTTPS origin in production", () => {
    expect(() => configuredAppOrigin({ NODE_ENV: "production" })).toThrow();
    expect(() =>
      configuredAppOrigin({
        NODE_ENV: "production",
        APP_ORIGIN: "http://localhost:3001",
      }),
    ).toThrow();
  });
});
describe("Codespaces origin regression with synthetic local injection only", () => {
  it("reproduces the exact deployment error before credentials are validated", async () => {
    const { app } = await buildApp({
      databasePath: ":memory:",
      origin: "http://localhost:4173",
    });
    try {
      const result = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: publicOrigin },
        payload: {},
      });
      expect(result.statusCode).toBe(403);
      expect(result.json().message).toBe("Origin not allowed");
    } finally {
      await app.close();
    }
  });
  it("accepts the exact configured public origin behind an internal proxy Host while retaining CSRF checks", async () => {
    const { app, repo } = await buildApp({
      databasePath: ":memory:",
      origin: publicOrigin + "/",
      production: true,
    });
    const password = "synthetic-origin-regression-only";
    try {
      await createUser(repo, {
        email: "origin@example.test",
        name: "Synthetic Origin",
        password,
        workspaceId: "synthetic",
      });
      const headers = {
        origin: publicOrigin,
        host: "127.0.0.1:3001",
        "x-forwarded-host": "ignored.example.test",
        "x-forwarded-proto": "http",
      };
      const preflight = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: {},
      });
      expect(preflight.statusCode).toBe(400); // Origin accepted; no credential was submitted.
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: { email: "origin@example.test", password },
      });
      expect(login.statusCode).toBe(200);
      expect(login.cookies[0]).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
      });
      const cookie = login.cookies[0]!.name + "=" + login.cookies[0]!.value;
      const source = { source: "Synthetic origin review" };
      const denied = await app.inject({
        method: "POST",
        url: "/api/proposals",
        headers: { ...headers, cookie, "idempotency-key": randomUUID() },
        payload: source,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().message).toBe("Invalid request token");
      const accepted = await app.inject({
        method: "POST",
        url: "/api/proposals",
        headers: {
          ...headers,
          cookie,
          "x-csrf-token": login.json().csrf,
          "idempotency-key": randomUUID(),
        },
        payload: source,
      });
      expect(accepted.statusCode).toBe(200);
      const foreign = await app.inject({
        method: "POST",
        url: "/api/proposals",
        headers: {
          ...headers,
          origin: "https://evil.example",
          cookie,
          "x-csrf-token": login.json().csrf,
          "idempotency-key": randomUUID(),
        },
        payload: source,
      });
      expect(foreign.statusCode).toBe(403);
      expect(foreign.json().message).toBe("Origin not allowed");
    } finally {
      await app.close();
    }
  });
  it.each([
    "https://evil.example",
    "null",
    publicOrigin.replace("https:", "http:"),
    publicOrigin + ".evil.example",
  ])(
    "rejects foreign origins even with forged Host and proxy headers %#",
    async (origin) => {
      const { app } = await buildApp({
        databasePath: ":memory:",
        origin: publicOrigin,
      });
      try {
        const result = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: {
            origin,
            host: new URL(publicOrigin).host,
            "x-forwarded-host": new URL(publicOrigin).host,
            "x-forwarded-proto": "https",
          },
          payload: {},
        });
        expect(result.statusCode).toBe(403);
        expect(result.json().message).toBe("Origin not allowed");
      } finally {
        await app.close();
      }
    },
  );
});

describe("temporary origin diagnostics redact everything outside the explicit allowlist", () => {
  it("logs only explicitly marked login probes when the operator enables diagnostics", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      for (const enabled of [false, true]) {
        const { app } = await buildApp({
          databasePath: ":memory:",
          origin: publicOrigin,
          originDiagnostics: enabled,
        });
        try {
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers: { origin: "https://evil.example" },
            payload: {},
          });
          expect(log).not.toHaveBeenCalled();
          const result = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers: {
              origin: "https://evil.example",
              "x-pm-origin-probe": "1",
              authorization: "Bearer synthetic-hidden",
            },
            payload: { password: "synthetic-hidden-password" },
          });
          expect(result.statusCode).toBe(403);
          expect(log).toHaveBeenCalledTimes(enabled ? 1 : 0);
          expect(JSON.stringify(log.mock.calls)).not.toContain(
            "synthetic-hidden",
          );
        } finally {
          await app.close();
        }
      }
    } finally {
      log.mockRestore();
    }
  });
  it("drops cookies, authorization, forwarding IPs and referer path/query secrets", async () => {
    const { safeOriginDiagnostic } =
      await import("../../apps/api/src/origin-diagnostics.js");
    const result = safeOriginDiagnostic(
      {
        origin: publicOrigin,
        host: new URL(publicOrigin).host,
        cookie: "synthetic-cookie-secret",
        authorization: "Bearer synthetic-token-secret",
        forwarded: `for=192.0.2.17;host="${new URL(publicOrigin).host}";proto=https`,
        referer:
          publicOrigin + "/projects?private=synthetic-referer-secret#fragment",
        "x-forwarded-host": new URL(publicOrigin).host,
        "x-forwarded-proto": "https",
      },
      publicOrigin,
      true,
    );
    expect(result).toMatchObject({
      origin: publicOrigin,
      refererOrigin: publicOrigin,
      forwardedHost: new URL(publicOrigin).host,
      peerIsLoopback: true,
    });
    const serialized = JSON.stringify(result);
    for (const omitted of [
      "synthetic-cookie-secret",
      "synthetic-token-secret",
      "192.0.2.17",
      "synthetic-referer-secret",
      "/projects",
      "fragment",
    ])
      expect(serialized).not.toContain(omitted);
    expect(
      safeOriginDiagnostic(
        {
          origin: "null",
          host: "user:secret@host.test",
          referer: "https://user:secret@host.test/path",
        },
        publicOrigin,
        false,
      ),
    ).toMatchObject({
      origin: "invalid",
      host: "invalid",
      refererOrigin: "invalid",
    });
  });
});
