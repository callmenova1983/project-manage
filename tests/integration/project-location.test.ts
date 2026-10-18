import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config.js";
import {
  cityLocation,
  districtLocation,
  pointLocation,
} from "../../packages/domain/project-location.js";
import {
  projectInput,
  type Project,
  type Snapshot,
} from "../../packages/domain/types.js";

let ctx: Awaited<ReturnType<typeof buildApp>>;
let cookie: string, csrf: string;
const origin = "http://localhost:4173";
const modelFetch = vi.fn<typeof fetch>();
const config: QwenConfig = {
  model: "qwen-test",
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic-test-token",
  budgetId: "location-test",
  maxRequests: 10,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 2048,
  retries: 0,
};
const request = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
beforeEach(async () => {
  modelFetch.mockReset();
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    qwen: config,
    aiFetch: modelFetch,
  });
  ctx.repo.seed("location-test");
  const password = randomUUID();
  await createUser(ctx.repo, {
    email: "location@example.test",
    name: "Location Tester",
    password,
    workspaceId: "location-test",
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "location@example.test", password },
  });
  cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(async () => ctx.app.close());

it.each([
  cityLocation("ningbo", "text", true, "宁波"),
  districtLocation("ningbo-beilun", "text", true, "北仑"),
  pointLocation(29.9, 121.8, "map", "用户地图选点", true),
])(
  "saves $precision locations with version checks, audit records, exports and imports",
  async (location) => {
    const original = ctx.repo.snapshot("location-test").projects[0]!;
    const response = await request("PUT", `/api/projects/${original.id}`, {
      ...projectInput.strip().parse(original),
      version: original.version,
      location,
    });
    expect(response.statusCode).toBe(200);
    const saved = response.json<Project>();
    expect(saved.location).toEqual(location);
    expect(saved.version).toBe(original.version + 1);
    const activity = ctx.repo
      .snapshot("location-test")
      .activities.find((a) => a.entityId === saved.id);
    expect((activity?.after as Project).location).toEqual(location);
    const stale = await request("PUT", `/api/projects/${original.id}`, {
      ...projectInput.strip().parse(original),
      version: original.version,
      location: null,
    });
    expect(stale.statusCode).toBe(409);
    const oldEditor = projectInput.strip().parse(saved);
    delete oldEditor.location;
    const edited = await request("PUT", `/api/projects/${saved.id}`, {
      ...oldEditor,
      version: saved.version,
      notes: "Other change",
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<Project>().location).toEqual(location);
    const exported = (await request("GET", "/api/export")).json<Snapshot>();
    expect(
      exported.projects.find((p) => p.id === original.id)?.location,
    ).toEqual(location);
    const imported = await request("POST", "/api/import", {
      ...exported,
      confirmed: true,
    });
    expect(imported.statusCode).toBe(200);
    const after = imported
      .json<Snapshot>()
      .projects.find((p) => p.id === original.id)!;
    expect(after.location).toEqual(location);
    const clear = await request("PUT", `/api/projects/${after.id}`, {
      ...projectInput.strip().parse(after),
      version: after.version,
      location: null,
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json<Project>().location).toBeNull();
  },
);

it("rejects mismatched or invalid locations before updating a project", async () => {
  const project = ctx.repo.snapshot("location-test").projects[0]!;
  const location = cityLocation("ningbo", "map", true);
  for (const invalid of [
    { ...location, cityId: "unknown" },
    { ...location, latitude: 91 },
    { ...location, longitude: 120 },
  ]) {
    const result = await request("PUT", `/api/projects/${project.id}`, {
      ...projectInput.strip().parse(project),
      version: project.version,
      location: invalid,
    });
    expect(result.statusCode).toBe(400);
  }
  expect(
    ctx.repo.get<Project>("projects", "location-test", project.id).version,
  ).toBe(project.version);
});

it("returns a validated AI candidate without saving, reuses idempotency, and sends only descriptive fields", async () => {
  const project = ctx.repo.snapshot("location-test").projects[0]!;
  project.name = "天一阁南馆";
  project.notes = "PRIVATE_NOTES";
  ctx.repo.putProject("location-test", project);
  modelFetch.mockResolvedValue(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              candidates: [{ cityId: "ningbo", evidence: "天一阁" }],
            }),
          },
        },
      ],
    }),
  );
  const key = randomUUID();
  const payload = {
    version: project.version,
    externalProcessingConfirmed: true,
  };
  const result = await request(
    "POST",
    `/api/projects/${project.id}/location/analyze`,
    payload,
    key,
  );
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    provider: "qwen",
    model: QWEN_MODEL,
    status: "matched",
    location: { cityId: "ningbo", confirmed: false, source: "ai" },
  });
  expect(
    ctx.repo.get<Project>("projects", "location-test", project.id).location,
  ).toBeUndefined();
  expect(
    ctx.repo.get<Project>("projects", "location-test", project.id).version,
  ).toBe(project.version);
  const same = await request(
    "POST",
    `/api/projects/${project.id}/location/analyze`,
    payload,
    key,
  );
  expect(same.json()).toEqual(result.json());
  expect(modelFetch).toHaveBeenCalledTimes(1);
  const body = String(modelFetch.mock.calls[0]![1]!.body);
  expect(body).not.toContain("PRIVATE_NOTES");
  expect(body).not.toContain(project.owner);
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS n FROM ai_attempts").get()?.n,
  ).toBe(1);
});

it("requires consent and a current project before any outbound AI request", async () => {
  const project = ctx.repo.snapshot("location-test").projects[0]!;
  const path = `/api/projects/${project.id}/location/analyze`;
  expect(
    (
      await request("POST", path, {
        version: project.version,
        externalProcessingConfirmed: false,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request("POST", path, {
        version: project.version + 1,
        externalProcessingConfirmed: true,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("POST", "/api/projects/not-in-workspace/location/analyze", {
        version: 1,
        externalProcessingConfirmed: true,
      })
    ).statusCode,
  ).toBe(404);
  expect(modelFetch).not.toHaveBeenCalled();
});

it("falls back to rules when the server model is disabled", async () => {
  await ctx.app.close();
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    aiFetch: modelFetch,
  });
  ctx.repo.seed("location-test");
  const password = randomUUID();
  await createUser(ctx.repo, {
    email: "location@example.test",
    name: "Location Tester",
    password,
    workspaceId: "location-test",
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "location@example.test", password },
  });
  cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
  const project = ctx.repo.snapshot("location-test").projects[0]!;
  project.name = "云和玩具城酒店";
  ctx.repo.putProject("location-test", project);
  const result = await request(
    "POST",
    `/api/projects/${project.id}/location/analyze`,
    { version: project.version, externalProcessingConfirmed: true },
  );
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    provider: "rules",
    model: null,
    location: { cityId: "lishui", confirmed: false },
  });
  expect(modelFetch).not.toHaveBeenCalled();
});
