import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { progressHistory } from "../../packages/domain/progress";
import { workspaceDataArchive } from "../../packages/domain/workspace-transfer";
import type { Activity } from "../../packages/domain/types";

let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173",
  password = "synthetic-transfer-password";
async function login(workspace = "source") {
  const result = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: `${workspace}@example.test`, password },
  });
  cookie = `pm_session=${result.cookies[0]!.value}`;
  csrf = result.json().csrf;
}
const request = (method: "GET" | "POST", url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
  });
beforeEach(async () => {
  ctx = await buildApp({ isolatedDatabase: true, origin });
  await ctx.repo.seed("source");
  await ctx.repo.workspace("target");
  for (const workspace of ["source", "target"])
    await createUser(ctx.repo, {
      workspaceId: workspace,
      email: `${workspace}@example.test`,
      name: workspace,
      password,
    });
  await ctx.repo.db.prepare("UPDATE users SET role='admin'").run();
  await login();
});
afterEach(() => ctx.app.close());

it("exports all history and original text without attachment bytes or broken references, then imports without duplicating records", async () => {
  const project = (await ctx.repo.snapshot("source")).projects[0]!;
  const sourceUser = (await ctx.repo.members("source"))[0]!;
  await ctx.repo.putProject("source", {
    ...project,
    owner: sourceUser.name,
    ownerId: sourceUser.id,
    notes: "项目跟进笔记",
  });
  const fileId = randomUUID();
  await ctx.repo.db
    .prepare(
      "INSERT INTO progress_materials(id,workspace_id,project_id,created_at,metadata,bytes,images) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      fileId,
      "source",
      project.id,
      new Date().toISOString(),
      JSON.stringify({
        id: fileId,
        name: "private-photo.png",
        kind: "image",
        size: 16,
        text: "",
        imageCount: 1,
        warnings: [],
      }),
      Buffer.from("private-file-data"),
      JSON.stringify(["data:image/png;base64,cHJpdmF0ZQ=="]),
    );
  for (let index = 0; index < 505; index++) {
    const event: Activity = {
      id: randomUUID(),
      projectId: project.id,
      entityId: project.id,
      kind: "project",
      action: "Added progress",
      actor: "历史记录人",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      source: index === 504 ? "Progress correction" : "Progress log",
      before: project,
      after: {
        ...project,
        latestUpdate: `跟进记录 ${index}`,
        reportedBy: "历史记录人",
        reportedAt: "2026-01-01T00:00:00.000Z",
      },
      progressSource: {
        text: "会议原文，需保留",
        materialIds: [fileId],
        recognizedText: "文字识别结果",
      },
    };
    await ctx.repo.audit("source", event);
  }
  const daily = {
    id: randomUUID(),
    source: "日报原文",
    workDate: "2026-01-01",
    reporter: "日报记录人",
    createdAt: "2026-01-01T00:00:00.000Z",
    rows: [
      {
        sourceLine: 1,
        text: "日报跟进",
        projectId: project.id,
        later: false,
        status: "recorded",
      },
    ],
  };
  await ctx.repo.db
    .prepare(
      "INSERT INTO daily_logs(id,workspace_id,fingerprint,created_at,data) VALUES(?,?,?,?,?)",
    )
    .run(
      daily.id,
      "source",
      "synthetic-daily",
      daily.createdAt,
      JSON.stringify(daily),
    );
  const response = await request("GET", "/api/workspace-data");
  expect(response.statusCode, response.body).toBe(200);
  const archive = workspaceDataArchive.parse(response.json());
  expect(archive.activities.length).toBeGreaterThan(500);
  expect(archive.dailyLogs).toHaveLength(1);
  expect(
    archive.activities.filter((event) => event.progressSource),
  ).toHaveLength(505);
  expect(
    archive.activities.every(
      (event) => !event.progressSource?.materialIds.length,
    ),
  ).toBe(true);
  expect(response.body).not.toContain(fileId);
  expect(response.body).not.toContain("private-file-data");
  expect(response.body).not.toContain("data:image");
  expect(response.body).not.toContain("progressFiles");
  expect(response.body).not.toContain("password_hash");
  await login("target");
  const imported = await request("POST", "/api/workspace-data", {
    archive,
    revision: (await ctx.repo.snapshot("target")).revision,
    confirmed: true,
  });
  expect(imported.statusCode, imported.body).toBe(200);
  expect(imported.json().receipt.projects.added).toBe(archive.projects.length);
  expect(imported.json().receipt.unlinkedAssignments).toBeGreaterThan(0);
  const targetProject = (await ctx.repo.snapshot("target")).projects.find(
    (p) => p.id === project.id,
  )!;
  expect(targetProject).toMatchObject({
    owner: "source",
    ownerId: null,
    notes: "项目跟进笔记",
  });
  const history = (
    await request("GET", `/api/projects/${project.id}/progress`)
  ).json();
  expect(
    history.filter(
      (entry: { originalSource?: unknown }) => entry.originalSource,
    ),
  ).toHaveLength(505);
  const importedCorrection = history.find(
    (entry: { correction: boolean; originalSource?: { text: string } }) =>
      entry.correction && entry.originalSource?.text === "会议原文，需保留",
  );
  expect(importedCorrection.originalSource).toMatchObject({
    text: "会议原文，需保留",
    materialIds: [],
  });
  expect(importedCorrection.author).toBe("历史记录人");
  expect(
    (await ctx.repo.db
      .prepare(
        "SELECT count(*) AS n FROM progress_materials WHERE workspace_id=?",
      )
      .get("target"))!.n,
  ).toBe(0);
  const repeated = await request("POST", "/api/workspace-data", {
    archive,
    revision: (await ctx.repo.snapshot("target")).revision,
    confirmed: true,
  });
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(repeated.json().receipt).toMatchObject({
    projects: { added: 0, updated: 0 },
    tasks: { added: 0, updated: 0 },
    activitiesAdded: 0,
    dailyLogsImported: 0,
  });
  expect(
    (await ctx.repo.db
      .prepare("SELECT count(*) AS n FROM daily_logs WHERE workspace_id=?")
      .get("target"))!.n,
  ).toBe(1);
  // Imported history can be exported and brought back without adding a second copy.
  const againResponse = await request("GET", "/api/workspace-data");
  expect(againResponse.statusCode, againResponse.body).toBe(200);
  const again = againResponse.json();
  await login();
  const before = (await ctx.repo.db
    .prepare("SELECT count(*) AS n FROM activities WHERE workspace_id=?")
    .get("source"))!.n;
  const back = await request("POST", "/api/workspace-data", {
    archive: again,
    revision: (await ctx.repo.snapshot("source")).revision,
    confirmed: true,
  });
  expect(back.statusCode, back.body).toBe(200);
  expect(back.json().receipt.activitiesAdded).toBe(2); // Only the two import receipts, never the 505 progress entries.
  expect(
    Number(
      (await ctx.repo.db
        .prepare("SELECT count(*) AS n FROM activities WHERE workspace_id=?")
        .get("source"))!.n,
    ),
  ).toBe(Number(before) + 3);
});

it("merges incoming updates while retaining unrelated projects and preserves version checks and atomic validation", async () => {
  const archive = (await request("GET", "/api/workspace-data")).json();
  const original = await ctx.repo.snapshot("source");
  archive.projects[0].notes = "导入的跟进笔记";
  archive.projects = archive.projects.slice(0, 1);
  archive.tasks = archive.tasks.filter(
    (task: { projectId: string }) => task.projectId === archive.projects[0].id,
  );
  const invalid = structuredClone(archive);
  invalid.tasks[0].projectId = "missing-project";
  const failed = await request("POST", "/api/workspace-data", {
    archive: invalid,
    revision: original.revision,
    confirmed: true,
  });
  expect(failed.statusCode).toBe(400);
  expect(await ctx.repo.snapshot("source")).toEqual(original);
  const stale = await request("POST", "/api/workspace-data", {
    archive,
    revision: original.revision + 1,
    confirmed: true,
  });
  expect(stale.statusCode).toBe(409);
  const saved = await request("POST", "/api/workspace-data", {
    archive,
    revision: original.revision,
    confirmed: true,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const after = await ctx.repo.snapshot("source");
  expect(after.projects).toHaveLength(original.projects.length);
  expect(after.tasks).toHaveLength(original.tasks.length);
  expect(
    after.projects.find((project) => project.id === archive.projects[0].id)!
      .notes,
  ).toBe("导入的跟进笔记");
  expect(saved.json().receipt.projects.updated).toBe(1);
  expect(
    progressHistory(after.projects[0]!, after.activities).length,
  ).toBeGreaterThan(0);
});
