import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../apps/web/src/services/mode", () => ({ browserDemo: false }));
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { HttpApi } from "../../apps/web/src/services/api";

let ctx: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:4173";
const workspaceId = "csrf-recovery-test";
const remoteFetch = vi.fn<typeof fetch>();

beforeEach(async () => {
  remoteFetch.mockReset();
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    wecomFetch: remoteFetch,
  });
  await createUser(ctx.repo, {
    workspaceId,
    email: "csrf-admin@example.test",
    name: "Synthetic administrator",
    password: "synthetic-integration-password",
  });
  ctx.repo.db.prepare("UPDATE users SET role='admin'").run();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.app.close();
});

it("recovers a rotated WeCom request token only after the server rejects the unchanged mutation without side effects", async () => {
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "csrf-admin@example.test",
      password: "synthetic-integration-password",
    },
  });
  expect(login.statusCode).toBe(200);
  const cookie = `pm_session=${login.cookies[0]!.value}`;
  const initialToken = login.json().csrf as string;
  const rotatedToken = "synthetic-rotated-request-token";
  const writes = () =>
    ctx.repo.db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM workspace_wecom_credentials) AS configurations, (SELECT COUNT(*) FROM admin_audit) AS audit, (SELECT COUNT(*) FROM idempotency) AS mutations",
      )
      .get();
  const beforeWrites = { configurations: 0, audit: 0, mutations: 0 };
  expect(writes()).toEqual(beforeWrites);

  const calls: {
    url: string;
    method: "GET" | "PUT";
    status: number;
    headers: Record<string, string>;
    body: string | undefined;
  }[] = [];
  let rejectedWrites = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url.startsWith("/api/")).toBe(true);
    const headers = {
      ...Object.fromEntries(new Headers(init.headers)),
      origin,
      cookie,
    };
    const method = init.method as "GET" | "PUT";
    const response = await ctx.app.inject({
      method,
      url,
      headers,
      payload: init.body as string | undefined,
    });
    calls.push({
      url,
      method,
      status: response.statusCode,
      headers,
      body: init.body as string | undefined,
    });
    if (method === "PUT" && response.statusCode === 403) {
      rejectedWrites++;
      expect(response.json()).toMatchObject({
        message: "Invalid request token",
      });
      expect(writes()).toEqual(beforeWrites);
      const unchanged = await ctx.app.inject({
        method: "GET",
        url: "/api/directory/wecom/config",
        headers: { origin, cookie },
      });
      expect(unchanged.json()).toEqual({
        version: 0,
        corpId: "",
        secretConfigured: false,
        source: "none",
      });
    }
    return new Response(response.body, { status: response.statusCode });
  });

  const api = new HttpApi();
  await api.session();
  ctx.repo.db.prepare("UPDATE sessions SET csrf=?").run(rotatedToken);
  const input = {
    version: 0,
    corpId: "synthetic-corp",
    secret: "synthetic-secret",
  };
  const saved = await api.saveWecomConfiguration(input);
  expect(saved).toEqual({
    version: 1,
    corpId: input.corpId,
    secretConfigured: true,
    source: "workspace",
  });
  expect(rejectedWrites).toBe(1);
  expect(calls.map(({ url, status }) => ({ url, status }))).toEqual([
    { url: "/api/auth/session", status: 200 },
    { url: "/api/directory/wecom/config", status: 403 },
    { url: "/api/auth/session", status: 200 },
    { url: "/api/directory/wecom/config", status: 200 },
  ]);
  const mutations = calls.filter(({ method }) => method === "PUT");
  expect(mutations[0]!.headers["x-csrf-token"]).toBe(initialToken);
  expect(mutations[1]!.headers["x-csrf-token"]).toBe(rotatedToken);
  expect(mutations[1]!.headers["idempotency-key"]).toBe(
    mutations[0]!.headers["idempotency-key"],
  );
  expect(mutations[0]!.body).toBe(JSON.stringify(input));
  expect(mutations[1]!.body).toBe(mutations[0]!.body);
  expect(writes()).toEqual({ configurations: 1, audit: 1, mutations: 1 });

  // A duplicate delivery with the accepted key is also safe at the real API.
  const repeated = await ctx.app.inject({
    method: "PUT",
    url: mutations[1]!.url,
    headers: mutations[1]!.headers,
    payload: mutations[1]!.body,
  });
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json()).toEqual(saved);
  expect(writes()).toEqual({ configurations: 1, audit: 1, mutations: 1 });
  expect(remoteFetch).not.toHaveBeenCalled();
});
