import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser, hashToken } from "../../apps/api/src/auth";
import {
  defaultCatalogs,
  defaultModelSettings,
} from "../../packages/domain/admin";
import { projectInput, taskInput } from "../../packages/domain/types";
import { writeModelLog } from "../../apps/api/src/admin";
import { recordModelCallUsage } from "../../apps/api/src/ai/usage";
import type { ModelLog } from "../../packages/domain/admin";
let context: Awaited<ReturnType<typeof buildApp>>,
  password = "",
  cookie = "",
  csrf = "";
const origin = "http://localhost:4173";
async function login(email = "admin@example.test") {
  const r = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  expect(r.statusCode).toBe(200);
  return {
    cookie: `pm_session=${r.cookies[0]!.value}`,
    csrf: r.json().csrf as string,
  };
}
const request = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  context.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
  });
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("team");
  password = randomBytes(24).toString("hex");
  for (const [email, name, ws] of [
    ["admin@example.test", "Admin", "team"],
    ["member@example.test", "Member", "team"],
    ["outside@example.test", "Outside", "other"],
  ])
    await createUser(context.repo, {
      email: email!,
      name: name!,
      workspaceId: ws!,
      password,
    });
  context.repo.db
    .prepare("UPDATE users SET role='admin' WHERE email='admin@example.test'")
    .run();
  ({ cookie, csrf } = await login());
});
afterEach(() => context.app.close());
describe("workspace administration", () => {
  it("distinguishes fully metered multi-call requests from partial and legacy retry logs", async () => {
    const makeLog = (): ModelLog => ({
      id: randomUUID(), createdAt: new Date().toISOString(), actor: "test",
      provider: "qwen", model: "test", mode: "real", status: "succeeded",
      durationMs: 1, inputTokens: null, outputTokens: null, cost: null,
      errorCode: null, attempts: 1,
    });
    const complete = makeLog();
    recordModelCallUsage(complete, { inputTokens: 10, outputTokens: 3 });
    complete.attempts = 2;
    recordModelCallUsage(complete, { inputTokens: 5, outputTokens: 2 });
    writeModelLog(context.repo, "team", complete);
    const partial = makeLog();
    partial.attempts = 2;
    recordModelCallUsage(partial, { inputTokens: 3, outputTokens: 1 });
    writeModelLog(context.repo, "team", partial);
    writeModelLog(context.repo, "team", { ...makeLog(), attempts: 2, inputTokens: 2, outputTokens: 1 });
    expect((await request("GET", "/api/ai/usage")).json()).toMatchObject({
      inputTokens: 20, outputTokens: 7, totalTokens: 27,
      measuredRequests: 1, unmeasuredRequests: 2, pendingRequests: 0,
    });
  });
  it("shows workspace token totals beyond 100 logs without exposing logs or estimating missing usage", async () => {
    const log = (patch: Partial<ModelLog> = {}): ModelLog => ({
      id: randomUUID(),
      createdAt: "2026-10-17T01:00:00.000Z",
      actor: "Synthetic actor",
      provider: "qwen",
      model: "synthetic-model",
      mode: "real",
      status: "succeeded",
      durationMs: 10,
      inputTokens: 10,
      outputTokens: 2,
      cost: null,
      errorCode: null,
      attempts: 1,
      ...patch,
    });
    for (let i = 0; i < 101; i++) writeModelLog(context.repo, "team", log());
    writeModelLog(context.repo, "team", log({ attempts: 2 }));
    writeModelLog(
      context.repo,
      "team",
      log({
        status: "failed",
        inputTokens: 7,
        outputTokens: null,
        createdAt: "2026-10-17T02:00:00.000Z",
      }),
    );
    writeModelLog(
      context.repo,
      "team",
      log({ status: "started", inputTokens: null, outputTokens: null }),
    );
    writeModelLog(
      context.repo,
      "team",
      log({ mode: "simulated", inputTokens: 99999 }),
    );
    writeModelLog(context.repo, "other", log({ inputTokens: 99999 }));
    ({ cookie, csrf } = await login("member@example.test"));
    const result = await request("GET", "/api/ai/usage");
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      inputTokens: 1027,
      outputTokens: 204,
      totalTokens: 1231,
      measuredRequests: 101,
      unmeasuredRequests: 2,
      pendingRequests: 1,
      last: {
        createdAt: "2026-10-17T02:00:00.000Z",
        inputTokens: 7,
        outputTokens: null,
        model: "synthetic-model",
      },
    });
    expect(JSON.stringify(result.json())).not.toContain("Synthetic actor");
    expect((await request("GET", "/api/admin/model/logs")).statusCode).toBe(
      403,
    );
    ({ cookie, csrf } = await login("outside@example.test"));
    expect((await request("GET", "/api/ai/usage")).json().inputTokens).toBe(
      99999,
    );
    expect(
      (await context.app.inject({ method: "GET", url: "/api/ai/usage" }))
        .statusCode,
    ).toBe(401);
    expect(
      context.repo.db
        .prepare("SELECT count(*) AS total FROM ai_attempts")
        .get()!.total,
    ).toBe(0);
  });
  it("round-trips version 3 schedules and dependencies and rejects invalid imports atomically", async () => {
    const initial = context.repo.snapshot("team");
    const leaves = initial.tasks.filter(
      (task) => !initial.tasks.some((child) => child.parentId === task.id),
    );
    const task = leaves[0]!;
    const predecessor = leaves.find(
      (item) => item.id !== task.id && item.projectId === task.projectId,
    )!;
    const planning = {
      scheduleStart: "2027-01-10",
      scheduleEnd: "2027-01-10",
      milestone: true,
      dependencies: [{ taskId: predecessor.id, type: "finish_to_start" }],
    };
    const changed = await request("PUT", `/api/tasks/${task.id}`, {
      ...taskInput.strip().parse(task),
      ...planning,
      version: task.version,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const exported = (await request("GET", "/api/export")).json();
    expect(exported.schemaVersion).toBe(3);
    const malformed = structuredClone(exported);
    malformed.tasks.find(
      (item: { id: string }) => item.id === task.id,
    ).dependencies = [{ taskId: "missing-task", type: "finish_to_start" }];
    const before = context.repo.snapshot("team");
    expect(
      (await request("POST", "/api/import", { ...malformed, confirmed: true }))
        .statusCode,
    ).toBe(400);
    expect(context.repo.snapshot("team")).toEqual(before);
    const missingCatalog = structuredClone(exported);
    delete missingCatalog.catalogs;
    expect(
      (
        await request("POST", "/api/import", {
          ...missingCatalog,
          confirmed: true,
        })
      ).statusCode,
    ).toBe(400);
    const imported = await request("POST", "/api/import", {
      ...exported,
      confirmed: true,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(
      context.repo.snapshot("team").tasks.find((item) => item.id === task.id),
    ).toMatchObject(planning);
    for (const schemaVersion of [1, 2]) {
      const revision = context.repo.snapshot("team").revision;
      const legacy = await request("POST", "/api/import", {
        ...exported,
        schemaVersion,
        revision,
        confirmed: true,
      });
      expect(legacy.statusCode, legacy.body).toBe(200);
      expect(
        context.repo.snapshot("team").tasks.find((item) => item.id === task.id),
      ).toMatchObject({
        scheduleStart: null,
        scheduleEnd: null,
        milestone: false,
        dependencies: [],
      });
    }
  });
  it("keeps project edits shared while denying non-admin reads/writes and cross-workspace user mutation", async () => {
    ({ cookie, csrf } = await login("member@example.test"));
    for (const url of [
      "/api/admin/users",
      "/api/admin/model",
      "/api/admin/model/logs",
      "/api/admin/audit",
    ])
      expect((await request("GET", url)).statusCode).toBe(403);
    expect(
      (await request("PUT", "/api/admin/catalogs", defaultCatalogs)).statusCode,
    ).toBe(403);
    const p = context.repo.snapshot("team").projects[0]!;
    expect(
      (
        await request("PUT", `/api/projects/${p.id}`, {
          ...projectInput.strip().parse(p),
          description: "Shared edit",
          version: p.version,
        })
      ).statusCode,
    ).toBe(200);
    ({ cookie, csrf } = await login());
    const outsider = context.repo.db
      .prepare("SELECT id FROM users WHERE email='outside@example.test'")
      .get()!;
    expect(
      (
        await request("PUT", `/api/admin/users/${outsider.id}`, {
          name: "Bad",
          email: "outside@example.test",
          role: "admin",
          status: "active",
          version: 1,
        })
      ).statusCode,
    ).toBe(404);
  });
  it("creates pending users once, stores only activation hashes, replaces/consumes tokens and issues no session", async () => {
    const key = randomUUID(),
      body = { name: "New member", email: "new@example.test", role: "member" };
    const user = (await request("POST", "/api/admin/users", body, key)).json();
    expect(user.status).toBe("pending");
    expect(
      (await request("POST", "/api/admin/users", body, key)).json().id,
    ).toBe(user.id);
    const first = (
      await request("POST", `/api/admin/users/${user.id}/activation`, {
        confirmed: true,
      })
    ).json();
    const second = (
      await request("POST", `/api/admin/users/${user.id}/activation`, {
        confirmed: true,
      })
    ).json();
    expect(second.token).not.toBe(first.token);
    const rows = context.repo.db
      .prepare("SELECT * FROM user_activations")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(hashToken(second.token));
    expect(
      JSON.stringify(
        context.repo.db.prepare("SELECT * FROM idempotency").all(),
      ),
    ).not.toContain(second.token);
    const activate = (token: string) =>
      context.app.inject({
        method: "POST",
        url: "/api/auth/activate",
        headers: { origin },
        payload: { token, password },
      });
    expect((await activate(first.token)).statusCode).toBe(400);
    const ok = await activate(second.token);
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies).toHaveLength(0);
    expect((await activate(second.token)).statusCode).toBe(400);
    expect((await login("new@example.test")).cookie).toContain("pm_session=");
    expect(
      JSON.stringify((await request("GET", "/api/admin/audit")).json()),
    ).not.toContain(second.token);
  });
  it("blocks expired/disabled activation and cannot bypass activation by changing account status", async () => {
    const user = (
      await request("POST", "/api/admin/users", {
        name: "Pending",
        email: "pending@example.test",
        role: "admin",
      })
    ).json();
    const token = (
      await request("POST", `/api/admin/users/${user.id}/activation`, {
        confirmed: true,
      })
    ).json().token;
    expect(
      (
        await request("PUT", `/api/admin/users/${user.id}`, {
          name: user.name,
          email: user.email,
          role: user.role,
          status: "active",
          version: 1,
        })
      ).statusCode,
    ).toBe(400);
    const disabled = (
      await request("PUT", `/api/admin/users/${user.id}`, {
        name: user.name,
        email: user.email,
        role: user.role,
        status: "disabled",
        version: 1,
      })
    ).json();
    expect(
      (
        await request("PUT", `/api/admin/users/${user.id}`, {
          name: user.name,
          email: user.email,
          role: user.role,
          status: "active",
          version: disabled.version,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/auth/activate",
          headers: { origin },
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("preserves the last active admin, checks versions and revokes disabled member sessions", async () => {
    const users = (await request("GET", "/api/admin/users")).json();
    const admin = users.find((u: { role: string }) => u.role === "admin"),
      member = users.find((u: { role: string }) => u.role === "member");
    expect(
      (
        await request("PUT", `/api/admin/users/${admin.id}`, {
          name: admin.name,
          email: admin.email,
          role: "member",
          status: "active",
          version: 1,
        })
      ).statusCode,
    ).toBe(409);
    const session = await login("member@example.test");
    expect(
      (
        await request("PUT", `/api/admin/users/${member.id}`, {
          name: member.name,
          email: member.email,
          role: "member",
          status: "disabled",
          version: 99,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request("PUT", `/api/admin/users/${member.id}`, {
          name: member.name,
          email: member.email,
          role: "member",
          status: "disabled",
          version: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await context.app.inject({
          url: "/api/workspace",
          headers: { cookie: session.cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin },
          payload: { email: member.email, password },
        })
      ).statusCode,
    ).toBe(401);
    expect(JSON.stringify(users)).not.toMatch(/password_hash|token_hash|csrf/);
  });
  it("updates real stage/category labels and rejects deleted/archived/unknown assignments", async () => {
    const next = structuredClone(defaultCatalogs);
    next.stages.push({
      id: "custom",
      en: "Review",
      zh: "复核",
      order: 5,
      color: "blue",
      archived: false,
    });
    next.categories.push({
      id: "customer",
      en: "Customer",
      zh: "客户项目",
      order: 0,
      color: "green",
      archived: false,
    });
    const result = await request("PUT", "/api/admin/catalogs", next);
    expect(result.statusCode).toBe(200);
    const catalog = result.json();
    const p = context.repo.snapshot("team").projects[0]!;
    const created = await request("POST", "/api/projects", {
      ...projectInput.strip().parse(p),
      name: "Catalog project",
      stage: "custom",
      categoryIds: ["customer"],
    });
    expect(created.statusCode).toBe(200);
    catalog.stages.find((s: { id: string }) => s.id === "custom").archived =
      true;
    expect(
      (await request("PUT", "/api/admin/catalogs", catalog)).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", "/api/projects", {
          ...projectInput.strip().parse(p),
          stage: "custom",
        })
      ).statusCode,
    ).toBe(400);
    const edited = created.json();
    expect(
      (
        await request("PUT", `/api/projects/${edited.id}`, {
          ...projectInput.strip().parse(edited),
          description: "Keep archived reference",
          version: edited.version,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request("PUT", "/api/admin/catalogs", {
          ...catalog,
          version: 3,
          stages: catalog.stages.filter(
            (s: { id: string }) => s.id !== "custom",
          ),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/projects", {
          ...projectInput.strip().parse(p),
          categoryIds: ["missing"],
        })
      ).statusCode,
    ).toBe(400);
  });
  it("exports version 3, reads legacy imports and prevents members changing catalogs through import", async () => {
    const exported = (await request("GET", "/api/export")).json();
    expect(exported.schemaVersion).toBe(3);
    expect(exported.catalogs.stages).toHaveLength(5);
    ({ cookie, csrf } = await login("member@example.test"));
    const changed = structuredClone(exported);
    changed.catalogs.stages[0].en = "Unapproved change";
    expect(
      (await request("POST", "/api/import", { ...changed, confirmed: true }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/import", {
          schemaVersion: 1,
          projects: exported.projects,
          tasks: exported.tasks,
          revision: exported.revision,
          confirmed: true,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("saves disabled model settings without provider access and rejects secrets/arbitrary references", async () => {
    const before = (await request("GET", "/api/admin/model")).json();
    expect(before.credentialAvailable).toBe(false);
    const input = { ...defaultModelSettings, timeoutMs: 10000 };
    expect((await request("PUT", "/api/admin/model", input)).statusCode).toBe(
      200,
    );
    expect(
      (
        await request("PUT", "/api/admin/model", {
          ...input,
          version: 2,
          enabled: true,
          secretRef: "server-default",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("PUT", "/api/admin/model", {
          ...input,
          version: 2,
          secretRef: "AWS_SECRET_ACCESS_KEY",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("PUT", "/api/admin/model", {
          ...input,
          version: 2,
          apiKey: "not-a-real-token",
        })
      ).statusCode,
    ).toBe(400);
    expect((await request("GET", "/api/admin/model/logs")).json()).toEqual([]);
    expect((await request("GET", "/api/ai/capabilities")).json().enabled).toBe(
      false,
    );
  });
});

it("rejects an expired activation without enabling the account", async () => {
  const user = (
    await request("POST", "/api/admin/users", {
      name: "Expired",
      email: "expired@example.test",
      role: "member",
    })
  ).json();
  const token = (
    await request("POST", `/api/admin/users/${user.id}/activation`, {
      confirmed: true,
    })
  ).json().token;
  context.repo.db.prepare("UPDATE user_activations SET expires_at=0").run();
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/activate",
    headers: { origin },
    payload: { token, password },
  });
  expect(response.statusCode).toBe(400);
  expect(
    context.repo.db.prepare("SELECT status FROM users WHERE id=?").get(user.id)!
      .status,
  ).toBe("pending");
});

describe("channel catalog and project records", () => {
  it("defaults new projects to company, preserves full names and short names, and persists channel assignments", async () => {
    const original = context.repo.snapshot("team").projects[0]!;
    const created = await request("POST", "/api/projects", {
      ...projectInput.strip().parse(original),
      name: "渠道测试项目完整名称",
      shortName: "渠道测试",
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      channelId: "company",
      name: "渠道测试项目完整名称",
      shortName: "渠道测试",
    });
    const p = created.json();
    const updated = await request("PUT", `/api/projects/${p.id}`, {
      ...projectInput.strip().parse(p),
      channelId: "boyu",
      version: p.version,
    });
    expect(updated.statusCode).toBe(200);
    expect(
      context.repo
        .snapshot("team")
        .projects.find((p) => p.id === updated.json().id),
    ).toMatchObject({ channelId: "boyu", shortName: "渠道测试" });
    const catalog = (await request("GET", "/api/catalogs")).json();
    catalog.channels.find((c: { id: string }) => c.id === "boyu").archived =
      true;
    expect(
      (await request("PUT", "/api/admin/catalogs", catalog)).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", "/api/projects", {
          ...projectInput.strip().parse(original),
          channelId: "boyu",
        })
      ).statusCode,
    ).toBe(400);
    const existing = updated.json();
    expect(
      (
        await request("PUT", `/api/projects/${existing.id}`, {
          ...projectInput.strip().parse(existing),
          version: existing.version,
          description: "停用后仍可维护历史项目",
        })
      ).statusCode,
    ).toBe(200);
  });
  it("denies member channel writes and rejects default-channel deactivation", async () => {
    const catalog = (await request("GET", "/api/catalogs")).json();
    catalog.channels.find((c: { id: string }) => c.id === "company").archived =
      true;
    expect(
      (await request("PUT", "/api/admin/catalogs", catalog)).statusCode,
    ).toBe(400);
    ({ cookie, csrf } = await login("member@example.test"));
    expect(
      (await request("PUT", "/api/admin/catalogs", defaultCatalogs)).statusCode,
    ).toBe(403);
  });
});

it("persists editable channel company profiles and multiple contacts without changing the default identity", async () => {
  const catalog = (await request("GET", "/api/catalogs")).json();
  const channel = catalog.channels.find(
    (c: { id: string }) => c.id === "company",
  );
  Object.assign(channel, {
    name: "测试公司完整名称",
    shortName: "测试公司",
    address: "测试地址",
    phone: "010-12345678",
    website: "https://example.test",
    creditCode: "SYNTHETIC",
    notes: "合作资料",
    contacts: [
      {
        id: "first",
        name: "测试联系人甲",
        phone: "10001",
        position: "商务",
        email: "first@example.test",
        primary: true,
      },
      {
        id: "second",
        name: "测试联系人乙",
        phone: "10002",
        position: "技术",
        wechat: "synthetic",
        primary: false,
      },
    ],
  });
  const saved = await request("PUT", "/api/admin/catalogs", catalog);
  expect(saved.statusCode).toBe(200);
  const reloaded = (await request("GET", "/api/catalogs"))
    .json()
    .channels.find((c: { id: string }) => c.id === "company");
  expect(reloaded).toEqual(channel);
  const old = context.repo.snapshot("team").projects[0]!;
  const project = await request(
    "POST",
    "/api/projects",
    projectInput.strip().parse(old),
  );
  expect(project.json().channelId).toBe("company");
});
