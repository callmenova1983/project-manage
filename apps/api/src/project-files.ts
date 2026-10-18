import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  projectFileInput,
  type ProjectFile,
} from "../../../packages/domain/project-file.js";
import type { Actor, Project, Task } from "../../../packages/domain/types.js";
import type { ProgressMaterial } from "../../../packages/domain/progress-material.js";
import { PROJECT_FILE_LIMIT } from "../../../packages/domain/progress-material.js";
import { HttpError, type Repository } from "./database.js";
import type { Mutate } from "./intake.js";
import { referenceArchiveInput } from "../../../packages/domain/capture-reference.js";
import { CAPTURE_SCOPE } from "../../../packages/domain/capture.js";
import { readMaterial } from "./progress-materials.js";

/** Project files and progress sources share the same private, backed-up blob store. */
export function registerProjectFiles(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
) {
  app.post("/api/capture/archive", (req) =>
    mutate(req, (a) => {
      const input = referenceArchiveInput.parse(req.body);
      const current = repo.get<Project>(
        "projects",
        a.workspaceId,
        input.projectId,
      );
      repo.checkVersion(current, input.version);
      // Validate every source before moving any file. mutate provides rollback and idempotency.
      const sources = input.files.map((file) => {
        if (file.taskId) {
          const task = repo.get<Task>("tasks", a.workspaceId, file.taskId);
          if (task.projectId !== current.id || task.voided)
            throw new HttpError(400, "关联任务不属于这个项目，或任务已作废。");
        }
        return {
          file,
          source: readMaterial(repo, a.workspaceId, CAPTURE_SCOPE, file.id),
        };
      });
      return sources.map(({ file, source }) => {
        const saved: ProjectFile = {
          ...source.metadata,
          category: file.category,
          ...(file.taskId ? { taskId: file.taskId } : {}),
          createdAt: new Date().toISOString(),
          uploadedBy: a.name,
        };
        repo.db
          .prepare(
            "UPDATE progress_materials SET project_id=?,metadata=? WHERE id=? AND workspace_id=? AND project_id=?",
          )
          .run(
            current.id,
            JSON.stringify(saved),
            file.id,
            a.workspaceId,
            CAPTURE_SCOPE,
          );
        repo.record(
          a,
          "project",
          "Archived project reference",
          current,
          current,
          `${saved.name} · ${file.category}`,
        );
        return saved;
      });
    }),
  );
  const project = (req: FastifyRequest) => {
    const a = actor(req);
    const id = (req.params as { id: string }).id;
    return { a, id, current: repo.get<Project>("projects", a.workspaceId, id) };
  };
  app.get("/api/projects/:id/files", (req): ProjectFile[] => {
    const { a, id } = project(req);
    return repo.db
      .prepare(
        "SELECT metadata,created_at FROM progress_materials WHERE workspace_id=? AND project_id=? ORDER BY created_at DESC,id DESC",
      )
      .all(a.workspaceId, id)
      .map((row) => ({
        ...(JSON.parse(String(row.metadata)) as ProgressMaterial),
        createdAt: String(row.created_at),
      }));
  });
  app.post(
    "/api/projects/:id/files",
    {
      bodyLimit: Math.ceil(PROJECT_FILE_LIMIT / 3) * 4 + 64 * 1024,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    (req) =>
      mutate(req, (a) => {
        const { id, current } = project(req);
        const input = projectFileInput.parse(req.body);
        const bytes = Buffer.from(input.data, "base64");
        if (
          !bytes.length ||
          bytes.length > PROJECT_FILE_LIMIT ||
          bytes.toString("base64") !== input.data
        )
          throw new HttpError(
            400,
            "文件内容无效或超过 50 MB。请分割文件后上传。",
          );
        const total = Number(
          repo.db
            .prepare(
              "SELECT coalesce(sum(length(bytes)),0) AS total FROM progress_materials WHERE workspace_id=?",
            )
            .get(a.workspaceId)!.total,
        );
        if (total + bytes.length > 256 * 1024 * 1024)
          throw new HttpError(
            400,
            "工作区附件已超过 256 MB，请联系管理员归档旧文件。",
          );
        const file: ProjectFile = {
          id: randomUUID(),
          name: input.name,
          kind: "file",
          size: bytes.length,
          text: "",
          imageCount: 0,
          warnings: [],
          createdAt: new Date().toISOString(),
          uploadedBy: a.name,
        };
        repo.db
          .prepare(
            "INSERT INTO progress_materials(id,workspace_id,project_id,created_at,metadata,bytes,images) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            file.id,
            a.workspaceId,
            id,
            file.createdAt,
            JSON.stringify(file),
            bytes,
            "[]",
          );
        repo.record(
          a,
          "project",
          "Uploaded project file",
          current,
          current,
          file.name,
        );
        return file;
      }),
  );
}
