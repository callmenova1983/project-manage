import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
let ctx: Awaited<ReturnType<typeof buildApp>>,
  folder: string,
  path: string,
  cookie: string,
  csrf: string;
const origin = "http://localhost:4173",
  password = "synthetic-password-test";
const fetcher = vi.fn<typeof fetch>();
const options = () => ({
  databasePath: path,
  origin,
  wecom: {
    corpId: "env-corp",
    secret: "synthetic-env-secret",
    workspaceId: "a",
  },
  wecomFetch: fetcher,
});
async function login(email = "admin@example.test") {
  const r = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  expect(r.statusCode).toBe(200);
  cookie = `pm_session=${r.cookies[0]!.value}`;
  csrf = r.json().csrf;
}
const request = (
  method: "GET" | "PUT" | "POST",
  url: string,
  payload?: unknown,
) =>
  ctx.app.inject({
    method,
    url,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
    payload: payload as Record<string, unknown>,
  });
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "pm-wecom-config-"));
  path = join(folder, "db.sqlite");
  fetcher.mockReset();
  ctx = await buildApp(options());
  ctx.repo.seed("a");
  for (const [email, workspaceId] of [
    ["admin@example.test", "a"],
    ["member@example.test", "a"],
    ["other@example.test", "b"],
  ])
    await createUser(ctx.repo, {
      name: email!,
      email: email!,
      workspaceId: workspaceId!,
      password,
    });
  ctx.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email!='member@example.test'")
    .run();
  await login();
});
afterEach(async () => {
  await ctx.app.close();
  rmSync(folder, { recursive: true, force: true });
});
it("shows configuration metadata without revealing the environment secret", async () => {
  const result = await request("GET", "/api/directory/wecom/config");
  expect(result.json()).toEqual({
    version: 0,
    corpId: "env-corp",
    secretConfigured: true,
    source: "environment",
  });
  expect(result.body).not.toContain("synthetic-env-secret");
  expect(fetcher).not.toHaveBeenCalled();
});
it("encrypts workspace credentials, preserves them across restart and leaves sync to an explicit action", async () => {
  const result = await request("PUT", "/api/directory/wecom/config", {
    version: 0,
    corpId: "new-corp",
    secret: "synthetic-new-secret",
  });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    version: 1,
    corpId: "new-corp",
    secretConfigured: true,
    source: "workspace",
  });
  expect(result.body).not.toContain("synthetic-new-secret");
  const row = ctx.repo.db
    .prepare(
      "SELECT encrypted_config FROM workspace_wecom_credentials WHERE workspace_id='a'",
    )
    .get()!;
  expect(String(row.encrypted_config)).not.toContain("synthetic-new-secret");
  expect(statSync(path + ".credentials-key").mode & 0o777).toBe(0o600);
  expect(fetcher).not.toHaveBeenCalled();
  await ctx.app.close();
  ctx = await buildApp(options());
  await login();
  expect(
    (await request("GET", "/api/directory/wecom/config")).json(),
  ).toMatchObject({ version: 1, corpId: "new-corp", secretConfigured: true });
  expect(
    (
      await request("PUT", "/api/directory/wecom/config", {
        version: 1,
        corpId: "new-corp",
        secret: "",
      })
    ).statusCode,
  ).toBe(200);
  fetcher.mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/gettoken")) {
      expect(parsed.searchParams.get("corpid")).toBe("new-corp");
      expect(parsed.searchParams.get("corpsecret")).toBe(
        "synthetic-new-secret",
      );
      return Response.json({ access_token: "synthetic-token" });
    }
    if (parsed.pathname.endsWith("/department/list"))
      return Response.json({
        department: [{ id: 1, name: "测试部门", parentid: 0 }],
      });
    return Response.json({ userlist: [] });
  });
  const sync = await request("POST", "/api/directory/wecom/sync", {
    version: ctx.repo.directory("a").version,
    confirmed: true,
  });
  expect(sync.statusCode).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("isolates workspace configuration and rejects member edits, stale versions and missing replacement secrets", async () => {
  expect(
    (
      await request("PUT", "/api/directory/wecom/config", {
        version: 0,
        corpId: "new-corp",
        secret: "",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request("PUT", "/api/directory/wecom/config", {
        version: 1,
        corpId: "env-corp",
        secret: "",
      })
    ).statusCode,
  ).toBe(409);
  await login("member@example.test");
  expect((await request("GET", "/api/directory/wecom/config")).statusCode).toBe(
    403,
  );
  expect(
    (
      await request("PUT", "/api/directory/wecom/config", {
        version: 0,
        corpId: "wrong",
        secret: "synthetic",
      })
    ).statusCode,
  ).toBe(403);
  await login("other@example.test");
  expect(
    (await request("GET", "/api/directory/wecom/config")).json(),
  ).toMatchObject({ corpId: "", secretConfigured: false, source: "none" });
  expect(
    (
      await request("PUT", "/api/directory/wecom/config", {
        version: 0,
        corpId: "other-corp",
        secret: "other-secret",
      })
    ).statusCode,
  ).toBe(200);
  await login();
  expect(
    (await request("GET", "/api/directory/wecom/config")).json().corpId,
  ).toBe("env-corp");
});
it("does not import a roster fetched with a configuration that changed during sync", async () => {
  let release!: (value: Response) => void;
  fetcher.mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/gettoken"))
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    if (parsed.pathname.endsWith("/department/list"))
      return Response.json({
        department: [{ id: 1, name: "测试部门", parentid: 0 }],
      });
    return Response.json({ userlist: [] });
  });
  const before = ctx.repo.directory("a");
  const syncing = request("POST", "/api/directory/wecom/sync", {
    version: before.version,
    confirmed: true,
  }).then((response) => response);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    (
      await request("PUT", "/api/directory/wecom/config", {
        version: 0,
        corpId: "changed-corp",
        secret: "synthetic-changed-secret",
      })
    ).statusCode,
  ).toBe(200);
  release(Response.json({ access_token: "synthetic-token" }));
  expect((await syncing).statusCode).toBe(409);
  expect(ctx.repo.directory("a")).toEqual(before);
});
