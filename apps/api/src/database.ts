import { assignLoginName } from "./login-name.js";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createSeed } from "../../../packages/domain/seed.js";
import { orderedProjectIds } from "../../../packages/domain/project-order.js";
import {
  directorySchema,
  emptyDirectory,
  type CompanyDirectory,
  type ProjectMember,
} from "../../../packages/domain/directory.js";
import {
  catalogsInput,
  defaultCatalogs,
  type Catalogs,
} from "../../../packages/domain/admin.js";
import {
  validateGraph,
  type Actor,
  type Project,
  type Task,
  type Snapshot,
  type Activity,
} from "../../../packages/domain/types.js";
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public current?: unknown,
  ) {
    super(message);
  }
}
export class Repository {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    for (const file of readdirSync(resolve("apps/api/migrations"))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort()) {
      const version = Number(file.split("_")[0]);
      if (
        this.db.prepare("SELECT 1 FROM migrations WHERE version=?").get(version)
      )
        continue;
      this.transaction(() => {
        this.db.exec(
          readFileSync(resolve("apps/api/migrations", file), "utf8"),
        );
        this.db
          .prepare(
            "INSERT OR IGNORE INTO migrations(version,applied_at) VALUES(?,?)",
          )
          .run(version, new Date().toISOString());
      });
    }
    const missingNames = this.db
      .prepare(
        "SELECT id,name FROM users WHERE username IS NULL ORDER BY rowid",
      )
      .all();
    if (missingNames.length)
      this.transaction(() => {
        for (const user of missingNames)
          this.db
            .prepare(
              "UPDATE users SET username=? WHERE id=? AND username IS NULL",
            )
            .run(assignLoginName(this.db, String(user.name)), String(user.id));
      });
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  workspace(id: string, name = "Team workspace") {
    this.db
      .prepare("INSERT OR IGNORE INTO workspaces(id,name) VALUES(?,?)")
      .run(id, name);
  }
  seed(workspaceId: string) {
    this.workspace(workspaceId);
    if (
      this.db
        .prepare("SELECT 1 FROM projects WHERE workspace_id=?")
        .get(workspaceId)
    )
      throw new HttpError(409, "Workspace already contains projects");
    const seed = createSeed();
    this.transaction(() => {
      for (const p of seed.projects) this.putProject(workspaceId, p);
      for (const t of seed.tasks) this.putTask(workspaceId, t);
      for (const a of seed.activities)
        this.audit(workspaceId, { ...a, id: randomUUID() });
    });
  }
  snapshot(workspaceId: string, includeSources = false): Snapshot {
    const row = this.db
      .prepare("SELECT revision FROM workspaces WHERE id=?")
      .get(workspaceId);
    if (!row) throw new HttpError(404, "Workspace not found");
    return {
      schemaVersion: 2,
      catalogs: this.catalogs(workspaceId),
      revision: Number(row.revision),
      projects: this.read<Project>("projects", workspaceId),
      tasks: this.read<Task>("tasks", workspaceId),
      activities: this.read<Activity>("activities", workspaceId).map((a) =>
        includeSources ? a : { ...a, progressSource: undefined },
      ),
      directory: this.directory(workspaceId),
      projectMembers: this.projectMembers(workspaceId),
      projectOrder: this.projectOrder(workspaceId),
    };
  }
  catalogs(workspaceId: string): Catalogs {
    const row = this.db
      .prepare("SELECT data FROM workspace_catalogs WHERE workspace_id=?")
      .get(workspaceId);
    return row
      ? catalogsInput.parse(JSON.parse(String(row.data)))
      : structuredClone(defaultCatalogs);
  }
  directory(workspaceId: string): CompanyDirectory {
    const row = this.db
      .prepare("SELECT data FROM workspace_directory WHERE workspace_id=?")
      .get(workspaceId);
    return row
      ? directorySchema.parse(JSON.parse(String(row.data)))
      : emptyDirectory();
  }
  projectOrder(ws: string) {
    const row = this.db
      .prepare("SELECT data FROM workspace_project_order WHERE workspace_id=?")
      .get(ws);
    return orderedProjectIds(
      this.read<Project>("projects", ws),
      row ? JSON.parse(String(row.data)) : [],
    );
  }
  projectMembers(workspaceId: string): ProjectMember[] {
    const directory = this.directory(workspaceId);
    return this.db
      .prepare(
        "SELECT project_id,user_id,users.name,joined_at,last_edited_at FROM project_members JOIN users ON users.id=project_members.user_id WHERE project_members.workspace_id=? ORDER BY joined_at,user_id",
      )
      .all(workspaceId)
      .map((row) => {
        const employee = directory.employees.find(
          (e) => e.userId === row.user_id,
        );
        return {
          projectId: String(row.project_id),
          userId: String(row.user_id),
          name: employee?.name ?? String(row.name),
          department:
            employee?.departmentIds
              .map(
                (id) =>
                  directory.departments.find((d) => d.id === id)?.name ?? "",
              )
              .filter(Boolean)
              .join(" / ") ?? "",
          position: employee?.position ?? "",
          joinedAt: String(row.joined_at),
          lastEditedAt: String(row.last_edited_at),
        };
      });
  }
  read<T>(table: "projects" | "tasks" | "activities", ws: string): T[] {
    return this.db
      .prepare(
        `SELECT data FROM ${table} WHERE workspace_id=?${table === "activities" ? " ORDER BY created_at DESC LIMIT 500" : ""}`,
      )
      .all(ws)
      .map((row) => JSON.parse(String(row.data)) as T);
  }
  get<T>(table: "projects" | "tasks", ws: string, id: string): T {
    const row = this.db
      .prepare(`SELECT data FROM ${table} WHERE workspace_id=? AND id=?`)
      .get(ws, id);
    if (!row) throw new HttpError(404, "Record not found");
    return JSON.parse(String(row.data)) as T;
  }
  checkVersion(current: Project | Task, version: number) {
    if (current.version !== version)
      throw new HttpError(
        409,
        "This record changed since you opened it. Review the latest version before saving.",
        current,
      );
  }
  putProject(ws: string, p: Project) {
    this.db
      .prepare(
        "INSERT INTO projects(id,workspace_id,version,data) VALUES(?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,data=excluded.data",
      )
      .run(p.id, ws, p.version, JSON.stringify(p));
  }
  putTask(ws: string, t: Task) {
    this.db
      .prepare(
        "INSERT INTO tasks(id,workspace_id,project_id,version,data) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,data=excluded.data,project_id=excluded.project_id",
      )
      .run(t.id, ws, t.projectId, t.version, JSON.stringify(t));
  }
  audit(ws: string, a: Activity) {
    this.db
      .prepare(
        "INSERT INTO activities(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
      )
      .run(a.id, ws, a.createdAt, JSON.stringify(a));
  }
  record(
    actor: Actor,
    kind: Activity["kind"],
    action: string,
    before: Project | Task | null,
    after: Project | Task | null,
    source = "Manual edit",
    progressSource?: Activity["progressSource"],
  ) {
    this.audit(actor.workspaceId, {
      id: randomUUID(),
      projectId:
        kind === "task"
          ? ((after as Task | null)?.projectId ??
            (before as Task | null)?.projectId ??
            null)
          : (after?.id ?? before?.id ?? null),
      entityId: after?.id ?? before?.id ?? actor.workspaceId,
      kind,
      action,
      actor: actor.name,
      createdAt: new Date().toISOString(),
      source,
      progressSource,
      before,
      after,
    });
    const projectId =
      kind === "task"
        ? (after as Task | null)?.projectId
        : kind === "project"
          ? after?.id
          : undefined;
    if (
      projectId &&
      this.db
        .prepare("SELECT 1 FROM users WHERE id=? AND workspace_id=?")
        .get(actor.id, actor.workspaceId)
    ) {
      const time = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO project_members(workspace_id,project_id,user_id,joined_at,last_edited_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET last_edited_at=excluded.last_edited_at",
        )
        .run(actor.workspaceId, projectId, actor.id, time, time);
    }
    this.db
      .prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?")
      .run(actor.workspaceId);
  }
  validate(ws: string) {
    const s = this.snapshot(ws);
    validateGraph(s.projects, s.tasks);
  }
}
