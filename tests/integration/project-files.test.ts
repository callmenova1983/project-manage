import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import {
  exportProgress,
  importProgress,
} from "../../apps/api/src/progress-export";
import { progressArchiveInput } from "../../packages/domain/progress-material";
import { filePreviewKind } from "../../packages/domain/project-file";

const origin = "http://localhost:4173";
let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
beforeEach(async () => {
  ctx = await buildApp({ databasePath: ":memory:", origin });
  ctx.repo.seed("files");
  ctx.repo.seed("other");
  await createUser(ctx.repo, {
    workspaceId: "files",
    name: "Uploader",
    email: "files@example.test",
    password: "synthetic-files-password",
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: "files@example.test",
      password: "synthetic-files-password",
    },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(() => ctx.app.close());
function request(
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) {
  return ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
}
it("persists raw attachments once, lists source materials too, and returns only authenticated project-scoped downloads", async () => {
  const [project, second] = ctx.repo.snapshot("files").projects;
  const before = { ...project! };
  const body = {
    name: "方案.pdf",
    data: Buffer.from("%PDF-1.4 synthetic attachment").toString("base64"),
  };
  const key = randomUUID();
  const saved = await request(
    "POST",
    `/api/projects/${project!.id}/files`,
    body,
    key,
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toMatchObject({
    name: body.name,
    kind: "file",
    uploadedBy: "Uploader",
  });
  expect(
    (
      await request("POST", `/api/projects/${project!.id}/files`, body, key)
    ).json(),
  ).toEqual(saved.json());
  const source = await request(
    "POST",
    `/api/projects/${project!.id}/materials`,
    {
      name: "原始日志.txt",
      data: Buffer.from("真实进展来源").toString("base64"),
    },
  );
  expect(source.statusCode).toBe(200);
  const foreignId = randomUUID();
  ctx.repo.db
    .prepare(
      "INSERT INTO progress_materials(id,workspace_id,project_id,created_at,metadata,bytes,images) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      foreignId,
      "other",
      project!.id,
      saved.json().createdAt,
      JSON.stringify({
        ...saved.json(),
        id: foreignId,
        name: "private-other-workspace.pdf",
      }),
      Buffer.from("private"),
      "[]",
    );
  const listing = await request("GET", `/api/projects/${project!.id}/files`);
  expect(listing.json()).toHaveLength(2);
  expect(listing.json().map((file: { name: string }) => file.name)).toContain(
    "原始日志.txt",
  );
  expect(listing.body).not.toContain(body.data);
  const path = `/api/projects/${project!.id}/materials/${saved.json().id}`;
  const downloaded = await request("GET", path);
  expect(downloaded.rawPayload).toEqual(Buffer.from(body.data, "base64"));
  expect(downloaded.headers["content-disposition"]).toContain("attachment;");
  expect(downloaded.headers["cache-control"]).toContain("no-store");
  expect((await ctx.app.inject({ method: "GET", url: path })).statusCode).toBe(
    401,
  );
  expect(
    (
      await request(
        "GET",
        `/api/projects/${second!.id}/materials/${saved.json().id}`,
      )
    ).statusCode,
  ).toBe(404);
  expect(listing.body).not.toContain("private-other-workspace");
  expect(
    (
      await request(
        "GET",
        `/api/projects/${project!.id}/materials/${foreignId}`,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    ctx.repo.snapshot("files").projects.find((p) => p.id === project!.id),
  ).toMatchObject({
    name: before.name,
    latestUpdate: before.latestUpdate,
    stage: before.stage,
  });
});
it("exports unlinked project files and restores their bytes, uploader and upload time", async () => {
  const project = ctx.repo.snapshot("files").projects[0]!;
  const file = (
    await request("POST", `/api/projects/${project.id}/files`, {
      name: "drawing.dwg",
      data: Buffer.from("unlinked drawing").toString("base64"),
    })
  ).json();
  const archive = progressArchiveInput.parse(exportProgress(ctx.repo, "files"));
  expect(archive.progressFiles).toHaveLength(1);
  expect(archive.progressFiles![0]!.metadata.id).toBe(file.id);
  ctx.repo.db
    .prepare("DELETE FROM progress_materials WHERE workspace_id=?")
    .run("files");
  importProgress(ctx.repo, "files", archive);
  const listing = (
    await request("GET", `/api/projects/${project.id}/files`)
  ).json();
  expect(listing[0]).toMatchObject({
    createdAt: file.createdAt,
    uploadedBy: "Uploader",
  });
  expect(
    (
      await request("GET", `/api/projects/${project.id}/materials/${file.id}`)
    ).rawPayload.toString(),
  ).toBe("unlinked drawing");
  expect(filePreviewKind("drawing.dwg")).toBe("download");
});
it("accepts exactly 50 MB and retains the file through archive restore", async () => {
  const project = ctx.repo.snapshot("files").projects[0]!;
  const bytes = Buffer.alloc(50 * 1024 * 1024, 0x5a);
  const response = await request("POST", `/api/projects/${project.id}/files`, {
    name: "large-contract.zip",
    data: bytes.toString("base64"),
  });
  expect(response.statusCode, response.body).toBe(200);
  const file = response.json();
  expect(file.size).toBe(50 * 1024 * 1024);
  const archive = progressArchiveInput.parse(exportProgress(ctx.repo, "files"));
  expect(archive.progressFiles![0]!.metadata.size).toBe(file.size);
  ctx.repo.db
    .prepare("DELETE FROM progress_materials WHERE workspace_id=?")
    .run("files");
  importProgress(ctx.repo, "files", archive);
  const restored = await request(
    "GET",
    `/api/projects/${project.id}/materials/${file.id}`,
  );
    expect(restored.rawPayload.equals(bytes)).toBe(true);
}, 30000);
it("rejects empty, oversized, malformed and unsafe-name uploads without saving a file", async () => {
  const project = ctx.repo.snapshot("files").projects[0]!;
  for (const body of [
    { name: "../contract.docx", data: "YWJj" },
    { name: "zero.txt", data: "" },
    { name: "bad.txt", data: "bad=" },
    {
      name: "large.zip",
      data: Buffer.alloc(50 * 1024 * 1024 + 1).toString("base64"),
    },
  ]) {
    const response = await request(
      "POST",
      `/api/projects/${project.id}/files`,
      body,
    );
    expect(response.statusCode, response.body).toBe(400);
  }
  expect(
    (await request("GET", `/api/projects/${project.id}/files`)).json(),
  ).toEqual([]);
  const rejected = await ctx.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/files`,
    headers: { cookie, origin },
    payload: { name: "not-saved.txt", data: "YWJj" },
  });
  expect(rejected.statusCode).toBe(403);
});
