import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import {
  parseDailyLog,
  looksLikeDailyLog,
} from "../../packages/domain/daily-log";
import { progressHistory } from "../../packages/domain/progress";
let context: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173";
const source =
  "1. 国鑫 协议判定优化更新\n2. 重儿 车位协议增加车牌联系人信息采集\n\n3) 大榭 集卡历史数据拉取沟通，xml对接跟进\n4) 能耗 补齐租户字段及历史迁移并更新测试\n5) 五粮液 电梯对接跟进";
const request = (url: string, payload: unknown) =>
  context.app.inject({
    method: "POST",
    url,
    payload: payload as Record<string, unknown>,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
  });
function input() {
  return {
    source,
    workDate: "2026-10-13",
    reporter: "张同事",
    confirmed: true,
    rows: parseDailyLog(source, []).map((r) => ({
      sourceLine: r.sourceLine,
      text: r.text,
      newProjectName: r.name,
      later: false,
    })),
  };
}
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("team");
  await createUser(context.repo, {
    name: "Member",
    email: "member@example.test",
    password: "synthetic-daily-log-password",
    workspaceId: "team",
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "member@example.test",
      password: "synthetic-daily-log-password",
    },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(() => context.app.close());
it("recognizes all five numbered lines and retains source line positions", () => {
  expect(looksLikeDailyLog(source)).toBe(true);
  const rows = parseDailyLog(source, []);
  expect(rows.map((r) => r.name)).toEqual([
    "国鑫",
    "重儿",
    "大榭",
    "能耗",
    "五粮液",
  ]);
  expect(rows.map((r) => r.sourceLine)).toEqual([1, 2, 4, 5, 6]);
  expect(rows[1]!.text).toBe("车位协议增加车牌联系人信息采集");
});
it("atomically archives progress with original/date/reporter and prevents repeated imports", async () => {
  const before = context.repo.snapshot("team");
  const res = await request("/api/daily-logs", input());
  expect(res.statusCode, res.body).toBe(200);
  const after = context.repo.snapshot("team");
  expect(after.projects.length).toBe(before.projects.length + 5);
  expect(after.tasks).toEqual(before.tasks);
  const project = after.projects.find((p) => p.name === "重儿")!;
  expect(project.reportedBy).toBe("张同事");
  expect(project.stage).toBe("unclassified");
  const entries = progressHistory(
    project,
    context.repo.snapshot("team", true).activities,
  );
  expect(entries[0]!.originalSource).toEqual({
    text: source,
    materialIds: [],
    workDate: "2026-10-13",
  });
  const repeat = await request("/api/daily-logs", input());
  expect(repeat.json().id).toBe(res.json().id);
  expect(context.repo.snapshot("team").revision).toBe(after.revision);
  expect(context.repo.snapshot("team").projects.length).toBe(
    after.projects.length,
  );
  const list = await context.app.inject({
    url: "/api/daily-logs",
    headers: { cookie },
  });
  expect(list.json()).toHaveLength(1);
});
it("persists pending rows and resumes only pending rows once", async () => {
  const data = input();
  data.rows[1]!.later = true;
  const first = await request("/api/daily-logs", data);
  expect(first.statusCode, first.body).toBe(200);
  const receipt = first.json();
  expect(receipt.rows[1].status).toBe("pending");
  const next = {
    ...data,
    batchId: receipt.id,
    rows: [{ ...data.rows[1]!, later: false }],
  };
  const second = await request("/api/daily-logs", next);
  expect(second.statusCode, second.body).toBe(200);
  expect(
    second
      .json()
      .rows.every((r: { status: string }) => r.status === "recorded"),
  ).toBe(true);
  const third = await request("/api/daily-logs", next);
  expect(third.statusCode).toBe(409);
  expect(
    context.repo.snapshot("team").projects.filter((p) => p.name === "重儿"),
  ).toHaveLength(1);
});
it("rolls back the whole batch on a stale project or foreign batch", async () => {
  const before = context.repo.snapshot("team");
  const data = input();
  data.rows[4] = {
    ...data.rows[4]!,
    projectId: before.projects[0]!.id,
    projectVersion: 999,
  } as (typeof data.rows)[number];
  const failed = await request("/api/daily-logs", data);
  expect(failed.statusCode).toBe(409);
  expect(context.repo.snapshot("team")).toEqual(before);
  expect(
    (await request("/api/daily-logs", { ...input(), batchId: randomUUID() }))
      .statusCode,
  ).toBe(404);
});
it("bulk fills details without changing progress and rejects conflicts atomically", async () => {
  await request("/api/daily-logs", input());
  const before = context.repo.snapshot("team");
  const projects = before.projects.filter((p) =>
    ["国鑫", "重儿"].includes(p.name),
  );
  const payload = {
    rows: projects.map((p) => ({
      id: p.id,
      version: p.version,
      fields: { owner: "张同事", stage: "in-progress" },
    })),
  };
  // Use an actual active catalog stage rather than assuming a display name.
  payload.rows.forEach(
    (r) =>
      (r.fields.stage = before.catalogs!.stages.find((s) => !s.archived)!.id),
  );
  const res = await request("/api/projects/bulk-fill", payload);
  expect(res.statusCode, res.body).toBe(200);
  for (const original of projects) {
    const saved = context.repo
      .snapshot("team")
      .projects.find((p) => p.id === original.id)!;
    expect(saved.owner).toBe("张同事");
    expect(saved.latestUpdate).toBe(original.latestUpdate);
    expect(saved.reportedAt).toBe(original.reportedAt);
  }
  const snapshot = context.repo.snapshot("team");
  expect((await request("/api/projects/bulk-fill", payload)).statusCode).toBe(
    409,
  );
  expect(context.repo.snapshot("team")).toEqual(snapshot);
});
it("groups multiple lines under one project and retains equal text on separate dates", async () => {
  const data = input();
  data.rows[1]!.newProjectName = "国鑫";
  expect((await request("/api/daily-logs", data)).statusCode).toBe(200);
  const first = context.repo
    .snapshot("team")
    .projects.find((p) => p.name === "国鑫")!;
  expect(first.latestUpdate).toContain("\n");
  const next = {
    ...data,
    workDate: "2026-10-14",
    rows: [
      {
        sourceLine: 1,
        text: first.latestUpdate,
        projectId: first.id,
        projectVersion: first.version,
        later: false,
      },
    ],
  };
  expect((await request("/api/daily-logs", next)).statusCode).toBe(200);
  const snapshot = context.repo.snapshot("team", true),
    project = snapshot.projects.find((p) => p.id === first.id)!;
  expect(
    progressHistory(project, snapshot.activities).filter(
      (e) => e.originalSource?.workDate,
    ),
  ).toHaveLength(2);
});
