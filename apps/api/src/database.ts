import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  weekBounds,
  type WorkspaceSettings,
} from "../../../packages/domain/time-zone.js";
import { createSeed } from "../../../packages/domain/seed.js";
import {
  projectMembers,
  taskMember,
} from "../../../packages/domain/members.js";
import {
  queryActivities,
  type ActivityQuery,
} from "../../../packages/domain/activity-query.js";
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
  type Member,
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
      schemaVersion: 2,
      catalogs: this.catalogs(workspaceId),
      settings: this.settings(workspaceId),
      members: this.members(workspaceId),
      revision: Number(row.revision),
      projects: this.read<Project>("projects", workspaceId),
      tasks: this.read<Task>("tasks", workspaceId),
      activities: this.read<Activity>("activities", workspaceId),
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
  members(workspaceId: string): Member[] {
    return this.db
      .prepare(
        "SELECT id,name,email,status FROM users WHERE workspace_id=? ORDER BY name,id",
      )
      .all(workspaceId) as unknown as Member[];
  }
  settings(workspaceId: string): WorkspaceSettings {
    const row = this.db
      .prepare("SELECT time_zone,settings_version FROM workspaces WHERE id=?")
      .get(workspaceId);
    if (!row) throw new HttpError(404, "Workspace not found");
    return {
      timeZone: String(row.time_zone),
      version: Number(row.settings_version),
    };
  }
  activityPage(workspaceId: string, query: ActivityQuery, exportAll = false) {
    const timeZone = this.settings(workspaceId).timeZone;
    if (query.timeZone && query.timeZone !== timeZone)
      throw new HttpError(
        409,
        "Workspace time zone changed. Refresh history before continuing.",
      );
    query = { ...query, timeZone };
    const through =
      query.cursor?.through ??
      query.checkpoint?.through ??
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(MAX(rowid),0) AS n FROM activities WHERE workspace_id=?",
          )
          .get(workspaceId)!.n,
      );
    const asOf =
      query.cursor?.asOf ?? query.checkpoint?.asOf ?? new Date().toISOString();
    const bounds = query.weekStart
      ? weekBounds(query.weekStart, timeZone)
      : null;
    const start = bounds?.start ?? "0001-01-01T00:00:00Z";
    const end = bounds?.end ?? "9999-12-31T23:59:59.999Z";
    const rows = this.db
      .prepare(
        "SELECT data FROM activities WHERE workspace_id=? AND rowid<=? AND julianday(created_at)>=julianday(?) AND julianday(created_at)<julianday(?) AND julianday(created_at)<=julianday(?) ORDER BY julianday(created_at) DESC,id ASC",
      )
      .iterate(workspaceId, through, start, end, asOf);
    function* events() {
      for (const row of rows) yield JSON.parse(String(row.data)) as Activity;
    }
    return queryActivities(events(), query, through, new Date(), exportAll);
  }
  activity(workspaceId: string, id: string): Activity {
    const row = this.db
      .prepare("SELECT data FROM activities WHERE workspace_id=? AND id=?")
      .get(workspaceId, id);
    if (!row) throw new HttpError(404, "History record not found");
    return JSON.parse(String(row.data));
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
  putProject(ws: string, p: Project, retained?: Project) {
    const previous = this.db
      .prepare("SELECT data FROM projects WHERE workspace_id=? AND id=?")
      .get(ws, p.id);
    Object.assign(
      p,
      projectMembers(
        p,
        this.members(ws),
        retained ?? (previous ? JSON.parse(String(previous.data)) : undefined),
      ),
    );
    this.db
      .prepare(
        "INSERT INTO projects(id,workspace_id,version,data) VALUES(?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,data=excluded.data",
      )
      .run(p.id, ws, p.version, JSON.stringify(p));
  }
  putTask(ws: string, t: Task, retained?: Task) {
    const previous = this.db
      .prepare("SELECT data FROM tasks WHERE workspace_id=? AND id=?")
      .get(ws, t.id);
    Object.assign(
      t,
      taskMember(
        t,
        this.members(ws),
        retained ?? (previous ? JSON.parse(String(previous.data)) : undefined),
      ),
    );
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
      actorId: actor.id,
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
