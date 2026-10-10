import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createSeed } from "../../../packages/domain/seed.js";
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
  snapshot(workspaceId: string): Snapshot {
    const row = this.db
      .prepare("SELECT revision FROM workspaces WHERE id=?")
      .get(workspaceId);
    if (!row) throw new HttpError(404, "Workspace not found");
    return {
      schemaVersion: 1,
      revision: Number(row.revision),
      projects: this.read<Project>("projects", workspaceId),
      tasks: this.read<Task>("tasks", workspaceId),
      activities: this.read<Activity>("activities", workspaceId),
    };
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
      before,
      after,
    });
    this.db
      .prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?")
      .run(actor.workspaceId);
  }
  validate(ws: string) {
    const s = this.snapshot(ws);
    validateGraph(s.projects, s.tasks);
  }
}
