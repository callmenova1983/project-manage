import { createHash } from "node:crypto";
import { progressHistory } from "../../../packages/domain/progress.js";
import { progressArchiveInput } from "../../../packages/domain/progress-material.js";
import type { Activity, Project } from "../../../packages/domain/types.js";
import { z } from "zod";
import { HttpError, type Repository } from "./database.js";
export function exportProgress(repo: Repository, ws: string) {
  const projects = repo.read<Project>("projects", ws);
  const projectIds = new Set(projects.map((project) => project.id));
  const activities = repo.db
    .prepare(
      "SELECT data FROM activities WHERE workspace_id=? ORDER BY created_at",
    )
    .all(ws)
    .map((r) => JSON.parse(String(r.data)) as Activity);
  const archive = projects.flatMap((project) =>
    progressHistory(project, activities).map((entry) => ({
      ...entry,
      projectId: project.id,
    })),
  );
  const ids = new Set(
    archive.flatMap((e) => e.originalSource?.materialIds ?? []),
  );
  const files = repo.db
    .prepare("SELECT * FROM progress_materials WHERE workspace_id=?")
    .all(ws)
    .filter(
      (r) => projectIds.has(String(r.project_id)) || ids.has(String(r.id)),
    )
    .map((r) => ({
      projectId: String(r.project_id),
      metadata: JSON.parse(String(r.metadata)),
      data: Buffer.from(r.bytes as Uint8Array).toString("base64"),
      images: JSON.parse(String(r.images)),
    }));
  return { progressArchive: archive, progressFiles: files };
}
export function importProgress(
  repo: Repository,
  ws: string,
  input: z.infer<typeof progressArchiveInput>,
) {
  const projects = repo.read<Project>("projects", ws),
    hasProject = (id: string) => projects.some((p) => p.id === id);
  for (const file of input.progressFiles ?? []) {
    if (!hasProject(file.projectId))
      throw new HttpError(400, "A source file references an unknown project");
    const bytes = Buffer.from(file.data, "base64");
    if (
      bytes.length !== file.metadata.size ||
      bytes.toString("base64") !== file.data ||
      file.images.length !== file.metadata.imageCount
    )
      throw new HttpError(400, "Invalid source file archive");
    const old = repo.db
      .prepare(
        "SELECT bytes,project_id FROM progress_materials WHERE workspace_id=? AND id=?",
      )
      .get(ws, file.metadata.id);
    if (old) {
      if (!bytes.equals(Buffer.from(old.bytes as Uint8Array)))
        throw new HttpError(
          409,
          "Source file archive conflicts with an existing file",
        );
      repo.db
        .prepare(
          "UPDATE progress_materials SET project_id=? WHERE workspace_id=? AND id=?",
        )
        .run(file.projectId, ws, file.metadata.id);
    } else
      repo.db
        .prepare(
          "INSERT INTO progress_materials(id,workspace_id,project_id,created_at,metadata,bytes,images) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          file.metadata.id,
          ws,
          file.projectId,
          file.metadata.createdAt ?? new Date().toISOString(),
          JSON.stringify(file.metadata),
          bytes,
          JSON.stringify(file.images),
        );
  }
  for (const entry of input.progressArchive ?? []) {
    const project = projects.find((p) => p.id === entry.projectId);
    if (!project)
      throw new HttpError(
        400,
        "A progress entry references an unknown project",
      );
    for (const id of entry.originalSource?.materialIds ?? [])
      if (
        !repo.db
          .prepare(
            "SELECT 1 FROM progress_materials WHERE workspace_id=? AND project_id=? AND id=?",
          )
          .get(ws, entry.projectId, id)
      )
        throw new HttpError(
          400,
          "A progress entry references a missing source file",
        );
    if (
      repo.db
        .prepare("SELECT 1 FROM activities WHERE workspace_id=? AND id=?")
        .get(ws, entry.id)
    )
      continue;
    const hash = createHash("sha256")
        .update(ws + ":" + entry.id)
        .digest("hex"),
      id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    if (repo.db.prepare("SELECT 1 FROM activities WHERE id=?").get(id))
      continue;
    repo.audit(ws, {
      id,
      projectId: project.id,
      entityId: project.id,
      kind: "project",
      action: "Imported progress history",
      actor: entry.author ?? "Reporter unavailable",
      createdAt:
        entry.recordedAt ?? entry.reportedAt ?? new Date().toISOString(),
      source: entry.correction ? "Progress correction" : "Progress log",
      before: null,
      after: {
        ...project,
        latestUpdate: entry.text,
        reportedAt: entry.reportedAt,
        reportedBy: entry.author,
      },
      progressSource: entry.originalSource,
    });
  }
}
