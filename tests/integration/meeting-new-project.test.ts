import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import type { Proposal } from "../../packages/domain/types";
let context: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  csrf: string,
  proposal: Proposal;
const origin = "http://localhost:4173";
const request = (url: string, payload: unknown, key = randomUUID()) =>
  context.app.inject({
    method: "POST",
    url,
    payload: payload as Record<string, unknown>,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
  });
const body = () => ({
  partial: true,
  updateMode: "append",
  suggestions: [
    {
      id: proposal.suggestions[0]!.id,
      selectedProjectId: "__new_project__",
      title: "跟进验收",
      action: "task",
      status: "todo",
      confirmed: true,
      overwriteConfirmed: false,
    },
  ],
  newProject: {
    suggestionId: proposal.suggestions[0]!.id,
    name: "韵升项目",
    channelId: "company",
    confirmed: true,
  },
});
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("team");
  await createUser(context.repo, {
    name: "Member",
    email: "member@example.test",
    password: "synthetic-meeting-password",
    workspaceId: "team",
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: {
      email: "member@example.test",
      password: "synthetic-meeting-password",
    },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
  proposal = (
    await request("/api/proposals", {
      source: "韵升平台验收，后续跟进运维费用商讨\n新项目另一条事项",
    })
  ).json();
});
afterEach(() => context.app.close());
it("persists a split meeting fact and followup separately and never replays either", async () => {
  const before = context.repo.snapshot("team");
  const project = before.projects[0]!;
  const source = `### ${project.name}\n- 设备已上线，下周继续检查运行情况。`;
  const created = await request("/api/proposals", { source });
  expect(created.statusCode).toBe(200);
  const draft = created.json<Proposal>();
  expect(draft.suggestions.map((item) => [item.action, item.status])).toEqual([
    ["update", "done"],
    ["task", "todo"],
  ]);
  const payload = {
    partial: true,
    updateMode: "append",
    suggestions: draft.suggestions.map((item) => ({
      id: item.id,
      selectedProjectId: project.id,
      title: item.title,
      action: item.action,
      status: item.status,
      confirmed: true,
      overwriteConfirmed: false,
    })),
  };
  const key = randomUUID();
  const result = await request(
    `/api/proposals/${draft.id}/apply`,
    payload,
    key,
  );
  expect(result.statusCode).toBe(200);
  const after = context.repo.snapshot("team");
  const newTasks = after.tasks.filter(
    (task) => !before.tasks.some((old) => old.id === task.id),
  );
  expect(newTasks).toHaveLength(1);
  expect(newTasks[0]).toMatchObject({
    projectId: project.id,
    title: "下周继续检查运行情况。",
    status: "todo",
    description: source.split("\n")[1],
  });
  expect(result.json<Proposal>().appliedResults).toEqual([
    { suggestionId: draft.suggestions[0]!.id, projectId: project.id },
    {
      suggestionId: draft.suggestions[1]!.id,
      projectId: project.id,
      taskId: newTasks[0]!.id,
    },
  ]);
  expect(
    after.projects.find((item) => item.id === project.id)?.latestUpdate,
  ).toContain("设备已上线");
  expect(
    after.projects.find((item) => item.id === project.id)?.latestUpdate,
  ).not.toContain("下周继续");
  expect(
    (await request(`/api/proposals/${draft.id}/apply`, payload, key)).json(),
  ).toEqual(result.json());
  expect(
    (await request(`/api/proposals/${draft.id}/apply`, payload)).statusCode,
  ).toBe(409);
  expect(context.repo.snapshot("team")).toEqual(after);
});
it("atomically creates a confirmed project and attaches only the selected meeting item, with idempotent replay", async () => {
  const before = context.repo.snapshot("team"),
    key = randomUUID();
  const response = await request(
    `/api/proposals/${proposal.id}/apply`,
    body(),
    key,
  );
  expect(response.statusCode).toBe(200);
  const snapshot = context.repo.snapshot("team"),
    created = snapshot.projects.find((project) => project.name === "韵升项目")!;
  expect(created).toMatchObject({
    channelId: "company",
    stage: "unclassified",
  });
  expect(snapshot.projects).toHaveLength(before.projects.length + 1);
  expect(
    snapshot.tasks.filter((task) => task.projectId === created.id),
  ).toMatchObject([
    { title: "跟进验收", description: proposal.suggestions[0]!.sourceText },
  ]);
  expect(response.json()).toMatchObject({
    status: "draft",
    source: proposal.source,
    appliedSuggestionIds: [proposal.suggestions[0]!.id],
  });
  expect(response.json().suggestions[0].selectedProjectId).toBe(created.id);
  expect(response.json().createdProjectIds).toEqual([created.id]);
  expect(response.json().appliedResults).toEqual([
    {
      suggestionId: proposal.suggestions[0]!.id,
      projectId: created.id,
      taskId: snapshot.tasks.find((task) => task.projectId === created.id)!.id,
    },
  ]);
  const replay = await request(
    `/api/proposals/${proposal.id}/apply`,
    body(),
    key,
  );
  expect(replay.json()).toEqual(response.json());
  expect(context.repo.snapshot("team").revision).toBe(snapshot.revision);
});
it("returns exact destinations for identical titles and keeps prior receipts through partial completion", async () => {
  proposal = (
    await request("/api/proposals", {
      source: "跟进设备调试\n跟进设备调试\n现场安装完成\n暂缓处理事项",
    })
  ).json();
  const projects = context.repo.snapshot("team").projects;
  const review = (index: number, projectId: string, action = "task") => ({
    id: proposal.suggestions[index]!.id,
    selectedProjectId: projectId,
    title: action === "task" ? "跟进设备调试" : "现场安装完成",
    action,
    status: action === "task" ? "todo" : "done",
    confirmed: true,
    overwriteConfirmed: false,
  });
  const first = await request(`/api/proposals/${proposal.id}/apply`, {
    partial: true,
    updateMode: "append",
    suggestions: [review(0, projects[0]!.id), review(1, projects[1]!.id)],
  });
  expect(first.statusCode).toBe(200);
  const receipts = first.json<Proposal>().appliedResults!;
  expect(receipts).toHaveLength(2);
  expect(receipts[0]!.taskId).not.toBe(receipts[1]!.taskId);
  const snapshot = context.repo.snapshot("team");
  for (const receipt of receipts) {
    expect(
      snapshot.tasks.find((task) => task.id === receipt.taskId),
    ).toMatchObject({
      projectId: receipt.projectId,
      title: "跟进设备调试",
    });
  }
  const second = await request(`/api/proposals/${proposal.id}/apply`, {
    partial: true,
    updateMode: "append",
    suggestions: [review(2, projects[0]!.id, "update")],
    skippedIds: [proposal.suggestions[3]!.id],
  });
  expect(second.statusCode).toBe(200);
  expect(second.json<Proposal>()).toMatchObject({
    status: "applied",
    appliedResults: [
      ...receipts,
      {
        suggestionId: proposal.suggestions[2]!.id,
        projectId: projects[0]!.id,
      },
    ],
    skippedSuggestionIds: [proposal.suggestions[3]!.id],
  });
  const persisted = context.repo.db
    .prepare("SELECT data FROM proposals WHERE id=?")
    .get(proposal.id)!;
  expect(JSON.parse(String(persisted.data)).appliedResults).toEqual(
    second.json<Proposal>().appliedResults,
  );
});
it("requires confirmation and prevents duplicate creation by name or an unavailable channel", async () => {
  const count = context.repo.snapshot("team").projects.length;
  const raw = body();
  expect(
    (
      await request(`/api/proposals/${proposal.id}/apply`, {
        ...raw,
        newProject: { ...raw.newProject, confirmed: false },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request(`/api/proposals/${proposal.id}/apply`, {
        ...raw,
        newProject: { ...raw.newProject, channelId: "missing" },
      })
    ).statusCode,
  ).toBe(409);
  const existing = context.repo.snapshot("team").projects[0]!;
  expect(
    (
      await request(`/api/proposals/${proposal.id}/apply`, {
        ...raw,
        newProject: { ...raw.newProject, name: existing.name },
      })
    ).statusCode,
  ).toBe(409);
  expect(context.repo.snapshot("team").projects).toHaveLength(count);
});
it("persists supplied project metadata instead of replacing it with blank defaults", async () => {
  const catalog = context.repo.catalogs("team");
  const { channelEntries } = await import("../../packages/domain/channels");
  const channels = [
    ...channelEntries(catalog),
    { id: "longying", name: "龙赢科技", shortName: "龙赢", archived: false },
  ];
  context.repo.db
    .prepare(
      "INSERT OR REPLACE INTO workspace_catalogs(workspace_id,data) VALUES(?,?)",
    )
    .run("team", JSON.stringify({ ...catalog, channels }));
  const payload = body();
  payload.newProject.name = "宁海数字平台项目";
  payload.newProject.channelId = "longying";
  const details = {
    client: "宁海学校",
    owner: "郑元杰",
    shortName: "宁海平台",
    stage: "implementation",
    aliases: ["宁海数平"],
    description: "数字平台建设",
  };
  const response = await request(`/api/proposals/${proposal.id}/apply`, {
    ...payload,
    newProject: { ...payload.newProject, details },
  });
  expect(response.statusCode).toBe(200);
  expect(
    context.repo
      .snapshot("team")
      .projects.find((project) => project.name === payload.newProject.name),
  ).toMatchObject({ channelId: "longying", ...details });
});
it("rolls back a created project if writing the meeting task fails", async () => {
  const before = context.repo.snapshot("team");
  const failure = vi
    .spyOn(context.repo, "putTask")
    .mockImplementationOnce(() => {
      throw new Error("simulated write failure");
    });
  expect(
    (await request(`/api/proposals/${proposal.id}/apply`, body())).statusCode,
  ).toBe(500);
  failure.mockRestore();
  expect(context.repo.snapshot("team")).toEqual(before);
  expect(
    (await request(`/api/proposals/${proposal.id}/apply`, body())).statusCode,
  ).toBe(200);
});
it("creates one project for a confirmed group of items and leaves another group pending", async () => {
  proposal = (
    await request("/api/proposals", {
      source:
        "重儿安消平台传感器点位标注\n数聚公司竞赛设备清单协助沟通\n重儿能耗分摊方案协助编制\n重儿地下室照明网关安装完善",
    })
  ).json();
  const selected = proposal.suggestions.filter((item) =>
    item.sourceText.startsWith("重儿"),
  );
  const payload = body();
  const grouped = {
    ...payload,
    suggestions: selected.map((item) => ({
      ...payload.suggestions[0]!,
      id: item.id,
      title: item.title,
    })),
    newProject: {
      ...payload.newProject,
      name: "重儿",
      suggestionId: selected[0]!.id,
      suggestionIds: selected.map((item) => item.id),
    },
  };
  const incomplete = await request(`/api/proposals/${proposal.id}/apply`, {
    ...grouped,
    newProject: { ...grouped.newProject, suggestionIds: [selected[0]!.id] },
  });
  expect(incomplete.statusCode).toBe(400);
  const result = await request(`/api/proposals/${proposal.id}/apply`, grouped);
  expect(result.statusCode).toBe(200);
  const snapshot = context.repo.snapshot("team"),
    created = snapshot.projects.filter((project) => project.name === "重儿");
  expect(created).toHaveLength(1);
  expect(
    snapshot.tasks
      .filter((task) => task.projectId === created[0]!.id)
      .map((task) => task.description),
  ).toEqual(selected.map((item) => item.sourceText));
  expect(result.json()).toMatchObject({
    status: "draft",
    appliedSuggestionIds: selected.map((item) => item.id),
  });
  const invalid = await request(`/api/proposals/${proposal.id}/apply`, {
    ...grouped,
    newProject: { ...grouped.newProject, suggestionIds: [selected[0]!.id] },
  });
  expect(invalid.statusCode).toBe(409);
});
