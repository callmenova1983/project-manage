import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app";
import { createUser, hashToken } from "../../apps/api/src/auth";
import { safeWecomReturn } from "../../packages/domain/wecom-login";
let ctx: Awaited<ReturnType<typeof buildApp>>;
let cookie: string, csrf: string, userId: string;
const origin = "http://localhost:4173",
  password = "synthetic-password-test";
const fetcher = vi.fn<typeof fetch>();
const headers = () => ({ origin, cookie, "x-csrf-token": csrf });
async function config(extra = {}) {
  const read = await ctx.app.inject({
    url: "/api/admin/wecom-login",
    headers: headers(),
  });
  return ctx.app.inject({
    method: "PUT",
    url: "/api/admin/wecom-login",
    headers: headers(),
    payload: {
      version: read.json().version,
      enabled: true,
      corpId: "corp-a",
      agentId: "1000001",
      secret: "synthetic-secret",
      autoProvision: false,
      ...extra,
    },
  });
}
async function directory(
  edit: (d: Awaited<ReturnType<typeof ctx.repo.directory>>) => void,
) {
  const d = await ctx.repo.directory("a");
  edit(d);
  await ctx.repo.db
    .prepare(
      "INSERT INTO workspace_directory(workspace_id,data) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET data=excluded.data",
    )
    .run("a", JSON.stringify(d));
}
async function start(returnTo = "/tasks?project=p#task") {
  const response = await ctx.app.inject({
    url: `/api/auth/wecom/start?workspace=a&returnTo=${encodeURIComponent(returnTo)}`,
  });
  expect(response.statusCode).toBe(302);
  const url = new URL(response.headers.location!);
  expect(url.searchParams.get("scope")).toBe("snsapi_base");
  return {
    url: `/api/auth/wecom/callback?code=one-time-code&state=${url.searchParams.get("state")}`,
    cookie: `pm_wecom_flow=${response.cookies[0]!.value}`,
  };
}
async function finish(flow: Awaited<ReturnType<typeof start>>) {
  return ctx.app.inject({ url: flow.url, headers: { cookie: flow.cookie } });
}
beforeEach(async () => {
  fetcher.mockReset();
  fetcher.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    return new Response(
      JSON.stringify(
        path.endsWith("gettoken")
          ? { access_token: "test-token" }
          : path.endsWith("getuserinfo")
            ? { errcode: 0, UserId: "employee-a" }
            : { errcode: 0, userid: "employee-a", status: 1 },
      ),
    );
  });
  ctx = await buildApp({
    isolatedDatabase: true,
    origin,
    wecomFetch: fetcher,
  });
  await ctx.repo.seed("a");
  await createUser(ctx.repo, {
    workspaceId: "a",
    email: "admin@example.test",
    name: "Admin",
    password,
  });
  await ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='admin@example.test'")
    .run();
  await createUser(ctx.repo, {
    workspaceId: "a",
    email: "member@example.test",
    name: "Member",
    password,
  });
  userId = String(
    (await ctx.repo.db
      .prepare("SELECT id FROM users WHERE email='member@example.test'")
      .get())!.id,
  );
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "admin@example.test", password },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
  await directory((d) => {
    d.employees.push({
      id: "e",
      employeeNo: "",
      name: "Member",
      email: "member@example.test",
      departmentIds: [],
      position: "",
      wecomUserId: "employee-a",
      wecomCorpId: "corp-a",
      userId,
      active: true,
      source: "wecom",
    });
  });
  expect((await config()).statusCode).toBe(200);
});
afterEach(async () => {
  await ctx.app.close();
});
it("logs in the bound account, preserves deep links and prevents replay", async () => {
  const flow = await start();
  const response = await finish(flow);
  expect(response.headers.location).toBe("/tasks?project=p#task");
  const sessionCookie = response.cookies.find((c) => c.name === "pm_session")!;
  expect(sessionCookie.httpOnly).toBe(true);
  expect(sessionCookie.sameSite).toBe("Lax");
  const session = await ctx.app.inject({
    url: "/api/auth/session",
    headers: { cookie: `pm_session=${sessionCookie.value}` },
  });
  expect(session.json().actor.id).toBe(userId);
  expect(session.json().actor.role).toBe("member");
  expect((await finish(flow)).headers.location).toContain(
    "wecom_error=expired",
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  await directory((d) => {
    d.employees[0]!.active = false;
  });
  expect(
    (
      await ctx.app.inject({
        url: "/api/auth/session",
        headers: { cookie: `pm_session=${sessionCookie.value}` },
      })
    ).statusCode,
  ).toBe(401);
});
it("binds the authorization request to the originating browser", async () => {
  const flow = await start();
  expect(
    (await finish({ ...flow, cookie: "pm_wecom_flow=attacker" })).headers
      .location,
  ).toContain("wecom_error=expired");
  expect(fetcher).not.toHaveBeenCalled();
  expect((await finish(flow)).headers.location).toBe("/tasks?project=p#task");
});
it("rejects expired requests and config changes during authorization", async () => {
  const flow = await start();
  await ctx.repo.db.prepare("UPDATE wecom_login_states SET expires_at=0").run();
  expect((await finish(flow)).headers.location).toContain(
    "wecom_error=expired",
  );
  const newer = await start();
  await config({ enabled: false });
  expect((await finish(newer)).headers.location).toContain(
    "wecom_error=unavailable",
  );
});
it.each(["wrong-corp", "inactive", "unlinked", "disabled", "pending"])(
  "rejects %s identities",
  async (kind) => {
    await directory((d) => {
      if (kind === "wrong-corp") d.employees[0]!.wecomCorpId = "corp-b";
      if (kind === "inactive") d.employees[0]!.active = false;
      if (kind === "unlinked") d.employees[0]!.userId = null;
    });
    if (kind === "disabled" || kind === "pending")
      await ctx.repo.db
        .prepare("UPDATE users SET status=? WHERE id=?")
        .run(kind, userId);
    const response = await finish(await start());
    expect(response.headers.location).toContain("wecom_error=");
    expect(response.cookies.some((c) => c.name === "pm_session")).toBe(false);
  },
);
it("creates only one ordinary member and does not merge by email", async () => {
  await config({ autoProvision: true });
  await directory((d) => {
    d.employees[0]!.userId = null;
  });
  expect((await finish(await start())).headers.location).toContain(
    "wecom_error=unlinked",
  );
  await directory((d) => {
    d.employees[0]!.email = "new@example.test";
  });
  expect((await finish(await start())).headers.location).not.toContain(
    "wecom_error",
  );
  const id = (await ctx.repo.directory("a")).employees[0]!.userId;
  expect(id).not.toBe(userId);
  expect(
    await ctx.repo.db
      .prepare("SELECT role,password_hash FROM users WHERE id=?")
      .get(id!),
  ).toMatchObject({ role: "member", password_hash: "!wecom-only" });
  await finish(await start());
  expect((await ctx.repo.directory("a")).employees[0]!.userId).toBe(id);
});
it("rejects another workspace's linked account", async () => {
  await ctx.repo.workspace("b");
  await ctx.repo.db
    .prepare("UPDATE users SET workspace_id='b' WHERE id=?")
    .run(userId);
  expect((await finish(await start())).headers.location).toContain(
    "wecom_error=disabled",
  );
});
it("handles upstream failures without exposing secrets", async () => {
  fetcher.mockRejectedValue(new Error("synthetic-secret"));
  const response = await finish(await start());
  expect(response.headers.location).toContain("wecom_error=upstream");
  expect(response.body).not.toContain("synthetic-secret");
  const state = await ctx.app.inject({
    url: "/api/admin/wecom-login",
    headers: headers(),
  });
  expect(state.body).not.toContain("synthetic-secret");
  expect(state.json().lastEvent.outcome).toContain("企微身份验证失败");
});
it("encrypts credentials and requires admin, CSRF and version checks", async () => {
  const row = (await ctx.repo.db
    .prepare("SELECT encrypted_config FROM wecom_login_config")
    .get())!;
  expect(String(row.encrypted_config)).not.toContain("synthetic-secret");
  expect(
    (await ctx.app.inject({ url: "/api/admin/wecom-login" })).statusCode,
  ).toBe(401);
  expect((await config({ version: 0 })).statusCode).toBe(409);
  expect(
    (
      await ctx.app.inject({
        method: "PUT",
        url: "/api/admin/wecom-login",
        headers: { origin, cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const flow = await finish(await start());
  const memberCookie = flow.cookies.find((c) => c.name === "pm_session")!;
  expect(
    (
      await ctx.app.inject({
        url: "/api/admin/wecom-login",
        headers: { cookie: `pm_session=${memberCookie.value}` },
      })
    ).statusCode,
  ).toBe(403);
  expect((await config({ corpId: "other", secret: "" })).statusCode).toBe(400);
});
it("does not reuse a revoked or different-workspace session", async () => {
  const response = await ctx.app.inject({
    url: "/api/auth/wecom/start?workspace=a&returnTo=/tasks",
    headers: { cookie },
  });
  expect(response.headers.location).toBe("/tasks");
  await ctx.repo.db
    .prepare("DELETE FROM sessions WHERE token_hash=?")
    .run(hashToken(cookie.split("=")[1]!));
  expect(
    (
      await ctx.app.inject({
        url: "/api/auth/wecom/start?workspace=a",
        headers: { cookie },
      })
    ).headers.location,
  ).toContain("open.weixin.qq.com");
});
it.each([
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/api/auth/logout",
  "/%61pi/auth/wecom/start",
  "/demo/",
  "/tasks\n",
])("rejects unsafe destination %s", (path) => {
  expect(safeWecomReturn(path)).toBe("/projects");
});
it("checks saved app credentials without claiming a complete client login", async () => {
  fetcher.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("gettoken")
            ? { access_token: "token" }
            : { agentid: 1000001 },
        ),
      ),
  );
  const result = await ctx.app.inject({
    method: "POST",
    url: "/api/admin/wecom-login/check",
    headers: headers(),
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().message).toContain("仍需从企微客户端验证");
});
it("rejects missing or inactive enterprise users", async () => {
  fetcher.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("gettoken")
            ? { access_token: "token" }
            : { OpenId: "external-person" },
        ),
      ),
  );
  expect((await finish(await start())).headers.location).toContain(
    "wecom_error=member",
  );
  fetcher.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("gettoken")
            ? { access_token: "token" }
            : String(url).includes("getuserinfo")
              ? { UserId: "employee-a" }
              : { userid: "employee-a", status: 2 },
        ),
      ),
  );
  expect((await finish(await start())).headers.location).toContain(
    "wecom_error=member",
  );
});
it("rechecks configuration after upstream calls complete", async () => {
  fetcher.mockImplementation(async (url) => {
    if (String(url).includes("user/get?")) {
      await config({ enabled: false });
      return new Response(JSON.stringify({ userid: "employee-a", status: 1 }));
    }
    return new Response(
      JSON.stringify(
        String(url).includes("gettoken")
          ? { access_token: "token" }
          : { UserId: "employee-a" },
      ),
    );
  });
  expect((await finish(await start())).headers.location).toContain(
    "wecom_error=unavailable",
  );
});
