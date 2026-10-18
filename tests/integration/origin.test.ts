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
      expect(preflight.headers["referrer-policy"]).toBe("no-referrer");
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

describe("opt-in Codespaces proxy rewrite", () => {
  const codespaceName = "stunning-chainsaw-7qqqqjq6px4crw4p";
  const environment = {
    CODESPACES_ORIGIN_REWRITE: "1",
    CODESPACES: "true",
    CODESPACE_NAME: codespaceName,
    HOST: "127.0.0.1",
    PORT: "3001",
  };
  const proxyHeaders = {
    origin: "http://localhost:3001",
    host: "localhost:3001",
    "x-forwarded-host": new URL(publicOrigin).host,
    "x-forwarded-proto": "https",
    referer: publicOrigin + "/projects",
    "sec-fetch-site": "same-origin",
  };
  it("is disabled by default and refuses broad or mismatched deployment configuration", async () => {
    const { configuredCodespacesRewrite } =
      await import("../../apps/api/src/origin.js");
    expect(configuredCodespacesRewrite({}, publicOrigin)).toBeUndefined();
    for (const changes of [
      { CODESPACES: undefined },
      { CODESPACE_NAME: "another-space" },
      { CODESPACE_NAME: "" },
      { HOST: "0.0.0.0" },
      { PORT: "3002" },
      { PORT: "-1" },
      { CODESPACES_ORIGIN_REWRITE: "true" },
    ])
      expect(() =>
        configuredCodespacesRewrite(
          { ...environment, ...changes },
          publicOrigin,
        ),
      ).toThrow();
    expect(() =>
      configuredCodespacesRewrite(environment, "https://other.example.test"),
    ).toThrow();
  });
  it("accepts only the measured proxy shape with a trusted browser Referer and local peer", async () => {
    const { configuredCodespacesRewrite, allowedMutationOrigin } =
      await import("../../apps/api/src/origin.js");
    const rewrite = configuredCodespacesRewrite(environment, publicOrigin);
    expect(allowedMutationOrigin(proxyHeaders, "127.0.0.1", publicOrigin)).toBe(
      false,
    );
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
      expect(
        allowedMutationOrigin(proxyHeaders, peer, publicOrigin, rewrite),
      ).toBe(true);
    for (const peer of [undefined, "192.0.2.7"])
      expect(
        allowedMutationOrigin(proxyHeaders, peer, publicOrigin, rewrite),
      ).toBe(false);
    for (const override of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "http://localhost:3002" },
      { origin: "http://127.0.0.1:3001" },
      { host: new URL(publicOrigin).host },
      { host: "localhost:3002" },
      { referer: undefined },
      { referer: "null" },
      { referer: "https://evil.example/path" },
      { referer: publicOrigin + ".evil.example/path" },
      { referer: "https://user:secret@" + new URL(publicOrigin).host + "/" },
      { "x-forwarded-host": undefined },
      { "x-forwarded-host": "evil.example" },
      { "x-forwarded-host": new URL(publicOrigin).host + ", evil.example" },
      { "x-forwarded-proto": undefined },
      { "x-forwarded-proto": "http" },
      { "x-forwarded-proto": "https,http" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { forwarded: "host=evil.example;proto=https" },
    ])
      expect(
        allowedMutationOrigin(
          { ...proxyHeaders, ...override },
          "127.0.0.1",
          publicOrigin,
          rewrite,
        ),
      ).toBe(false);
    expect(
      allowedMutationOrigin(
        { origin: publicOrigin, referer: "https://evil.example/" },
        "127.0.0.1",
        publicOrigin,
        rewrite,
      ),
    ).toBe(false);
  });
  it("preserves login, Secure sessions, authentication, and CSRF behind the exact proxy rewrite", async () => {
    const { configuredCodespacesRewrite } =
      await import("../../apps/api/src/origin.js");
    const { app, repo } = await buildApp({
      databasePath: ":memory:",
      origin: publicOrigin,
      production: true,
      codespacesOriginRewrite: configuredCodespacesRewrite(
        environment,
        publicOrigin,
      ),
    });
    try {
      const credential = {
        email: "proxy@example.test",
        password: "synthetic-proxy-regression-only",
      };
      await createUser(repo, {
        ...credential,
        name: "Synthetic Proxy",
        workspaceId: "synthetic",
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: proxyHeaders,
        payload: credential,
        remoteAddress: "127.0.0.1",
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["referrer-policy"]).toBe("same-origin");
      expect(login.cookies[0]).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
      });
      const cookie = login.cookies[0]!.name + "=" + login.cookies[0]!.value;
      const post = (headers: Record<string, string | undefined>) =>
        app.inject({
          method: "POST",
          url: "/api/proposals",
          headers: { ...proxyHeaders, ...headers },
          payload: { source: "Synthetic rewrite check" },
          remoteAddress: "127.0.0.1",
        });
      expect((await post({})).statusCode).toBe(401);
      const noToken = await post({ cookie });
      expect(noToken.statusCode).toBe(403);
      expect(noToken.json().message).toBe("Invalid request token");
      const auth = {
        cookie,
        "x-csrf-token": login.json().csrf,
        "idempotency-key": randomUUID(),
      };
      expect((await post(auth)).statusCode).toBe(200);
      for (const override of [
        { referer: "https://evil.example/path" },
        { origin: "https://evil.example" },
        { "sec-fetch-site": "cross-site" },
      ]) {
        const denied = await post({ ...auth, ...override });
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toBe("Origin not allowed");
      }
      // Forwarding headers and a forged Referer from a remote peer do not opt in.
      const remote = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: proxyHeaders,
        payload: {},
        remoteAddress: "192.0.2.10",
      });
      expect(remote.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

it("allows explicit LAN and loopback origins while rejecting mismatched and foreign origins", async () => {
  const { app } = await buildApp({
    databasePath: ":memory:",
    origin: "http://localhost:4173",
    additionalOrigins: ["http://192.168.110.4:4173", "http://127.0.0.1:4173"],
  });
  try {
    for (const origin of [
      "http://localhost:4173",
      "http://192.168.110.4:4173",
      "http://127.0.0.1:4173",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin, referer: origin + "/" },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }
    for (const headers of [
      { origin: "http://evil.test" },
      { origin: "http://192.168.110.5:4173" },
      {
        origin: "http://192.168.110.4:4173",
        referer: "http://localhost:4173/",
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    }
  } finally {
    await app.close();
  }
});
