import { retainTaskSchedule } from "../../../packages/domain/task-schedule.js";
import { assertProjectWritable } from "../../../packages/domain/project-lifecycle.js";
import {
  normalizeTaskOrder,
  nextTaskSortOrder,
} from "../../../packages/domain/task-move.js";
import { assignLoginName } from "./login-name.js";
import { PostgresDatabase } from "./postgres.js";
import { readDatabaseConfig, type DatabaseConfig } from "./database-config.js";

import { randomUUID } from "node:crypto";
import {
  weekBounds,
  type WorkspaceSettings,
} from "../../../packages/domain/time-zone.js";
import { createSeed } from "../../../packages/domain/seed.js";
import { orderedProjectIds } from "../../../packages/domain/project-order.js";
import {
  directorySchema,
  emptyDirectory,
  type CompanyDirectory,
  type ProjectMember,
} from "../../../packages/domain/directory.js";
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
  private constructor(
    readonly db: PostgresDatabase,
    private readonly isolated = false,
  ) {}
  static async open(
    config: DatabaseConfig = readDatabaseConfig(),
    options: { isolated?: boolean } = {},
  ) {
    const resolved = options.isolated
      ? { ...config, schema: `pm_test_${randomUUID().replaceAll("-", "")}` }
      : config;
    const db = new PostgresDatabase(resolved);
    try {
      await db.initialize();
      const repo = new Repository(db, !!options.isolated);
      const missing = await db
        .prepare(
          "SELECT id,name FROM users WHERE username IS NULL ORDER BY rowid",
        )
        .all();
      if (missing.length)
        await repo.transaction(async () => {
          for (const user of missing)
            await db
              .prepare(
                "UPDATE users SET username=? WHERE id=? AND username IS NULL",
              )
              .run(
                await assignLoginName(db, String(user.name)),
                String(user.id),
              );
        });
      return repo;
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  async close() {
    try {
      if (this.isolated)
        await this.db.exec(`DROP SCHEMA "${this.db.schema}" CASCADE`);
    } finally {
      await this.db.close();
    }
  }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return await this.db.transaction(fn);
  }
  async workspace(id: string, name = "Team workspace") {
    await this.db
      .prepare(
        "INSERT INTO workspaces(id,name) VALUES(?,?) ON CONFLICT DO NOTHING",
      )
      .run(id, name);
  }
  async seed(workspaceId: string) {
    await this.workspace(workspaceId);
    if (
      await this.db
        .prepare("SELECT 1 FROM projects WHERE workspace_id=?")
        .get(workspaceId)
    )
      throw new HttpError(409, "Workspace already contains projects");
    const seed = createSeed();
    await this.transaction(async () => {
      if (
        await this.db
          .prepare("SELECT 1 FROM projects WHERE workspace_id=?")
          .get(workspaceId)
      )
        throw new HttpError(409, "Workspace already contains projects");
      const members = await this.members(workspaceId);
      const projects = seed.projects.map((p) => projectMembers(p, members));
      const tasks = normalizeTaskOrder(seed.tasks).map((t) => ({
        ...taskMember(t, members),
        ...retainTaskSchedule(t),
      }));
      validateGraph(projects, tasks);
      // Seed is a known complete graph: insert each table in one batch instead of
      // issuing hundreds of network round trips for per-row lookups.
      const insert = async (
        table: string,
        columns: string[],
        rows: unknown[][],
      ) => {
        if (!rows.length) return;
        const values = rows.flat();
        const tuples = rows
          .map(
            (row, i) =>
              `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(",")})`,
          )
          .join(",");
        await this.db.query(
          `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples}`,
          values,
        );
      };
      await insert(
        "projects",
        ["id", "workspace_id", "version", "data"],
        projects.map((p) => [p.id, workspaceId, p.version, JSON.stringify(p)]),
      );
      await insert(
        "tasks",
        ["id", "workspace_id", "project_id", "version", "data"],
        tasks.map((t) => [
          t.id,
          workspaceId,
          t.projectId,
          t.version,
          JSON.stringify(t),
        ]),
      );
      await insert(
        "activities",
        ["id", "workspace_id", "created_at", "data"],
        seed.activities.map((a) => {
          const event = { ...a, id: randomUUID() };
          return [
            event.id,
            workspaceId,
            event.createdAt,
            JSON.stringify(event),
          ];
        }),
      );
    });
  }

  async snapshot(
    workspaceId: string,
    includeSources = false,
  ): Promise<Snapshot> {
    return this.db.readSnapshot(() =>
      this.snapshotData(workspaceId, includeSources),
    );
  }
  private async snapshotData(
    workspaceId: string,
    includeSources: boolean,
  ): Promise<Snapshot> {
    const row = await this.db
      .prepare("SELECT revision FROM workspaces WHERE id=?")
      .get(workspaceId);
    if (!row) throw new HttpError(404, "Workspace not found");
    return {
      schemaVersion: 3,
      catalogs: await this.catalogs(workspaceId),
      settings: await this.settings(workspaceId),
      members: await this.members(workspaceId),
      revision: Number(row.revision),
      projects: await this.read<Project>("projects", workspaceId),
      tasks: await this.read<Task>("tasks", workspaceId),
      activities: (await this.read<Activity>("activities", workspaceId)).map(
        (a) => (includeSources ? a : { ...a, progressSource: undefined }),
      ),
      directory: await this.directory(workspaceId),
      projectMembers: await this.projectMembers(workspaceId),
      projectOrder: await this.projectOrder(workspaceId),
    };
  }
  async catalogs(workspaceId: string): Promise<Catalogs> {
    const row = await this.db
      .prepare("SELECT data FROM workspace_catalogs WHERE workspace_id=?")
      .get(workspaceId);
    return row
      ? catalogsInput.parse(JSON.parse(String(row.data)))
      : structuredClone(defaultCatalogs);
  }
  async directory(workspaceId: string): Promise<CompanyDirectory> {
    const row = await this.db
      .prepare("SELECT data FROM workspace_directory WHERE workspace_id=?")
      .get(workspaceId);
    return row
      ? directorySchema.parse(JSON.parse(String(row.data)))
      : emptyDirectory();
  }
  async projectOrder(ws: string) {
    const row = await this.db
      .prepare("SELECT data FROM workspace_project_order WHERE workspace_id=?")
      .get(ws);
    return orderedProjectIds(
      await this.read<Project>("projects", ws),
      row ? JSON.parse(String(row.data)) : [],
    );
  }
  async projectMembers(workspaceId: string): Promise<ProjectMember[]> {
    const directory = await this.directory(workspaceId);
    return (
      await this.db
        .prepare(
          "SELECT project_id,user_id,users.name,joined_at,last_edited_at FROM project_members JOIN users ON users.id=project_members.user_id WHERE project_members.workspace_id=? ORDER BY joined_at,user_id",
        )
        .all(workspaceId)
    ).map((row) => {
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
  async members(workspaceId: string): Promise<Member[]> {
    return (await this.db
      .prepare(
        "SELECT id,name,email,status FROM users WHERE workspace_id=? ORDER BY name,id",
      )
      .all(workspaceId)) as unknown as Member[];
  }
  async settings(workspaceId: string): Promise<WorkspaceSettings> {
    const row = await this.db
      .prepare("SELECT time_zone,settings_version FROM workspaces WHERE id=?")
      .get(workspaceId);
    if (!row) throw new HttpError(404, "Workspace not found");
    return {
      timeZone: String(row.time_zone),
      version: Number(row.settings_version),
    };
  }
  async activityPage(
    workspaceId: string,
    query: ActivityQuery,
    exportAll = false,
  ) {
    return this.db.readSnapshot(() =>
      this.activityPageData(workspaceId, query, exportAll),
    );
  }
  private async activityPageData(
    workspaceId: string,
    query: ActivityQuery,
    exportAll: boolean,
  ) {
    const timeZone = (await this.settings(workspaceId)).timeZone;
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
        (await this.db
          .prepare(
            "SELECT COALESCE(MAX(rowid),0) AS n FROM activities WHERE workspace_id=?",
          )
          .get(workspaceId))!.n,
      );
    const asOf =
      query.cursor?.asOf ?? query.checkpoint?.asOf ?? new Date().toISOString();
    const bounds = query.weekStart
      ? weekBounds(query.weekStart, timeZone)
      : null;
    const start = bounds?.start ?? "0001-01-01T00:00:00Z";
    const end = bounds?.end ?? "9999-12-31T23:59:59.999Z";
    const rows = await this.db
      .prepare(
        "SELECT data FROM activities WHERE workspace_id=? AND rowid<=? AND created_at::timestamptz>=?::timestamptz AND created_at::timestamptz<?::timestamptz AND created_at::timestamptz<=?::timestamptz ORDER BY created_at::timestamptz DESC,id ASC",
      )
      .all(workspaceId, through, start, end, asOf);
    function* events() {
      for (const row of rows) yield JSON.parse(String(row.data)) as Activity;
    }
    return queryActivities(events(), query, through, new Date(), exportAll);
  }
  async activity(workspaceId: string, id: string): Promise<Activity> {
    const row = await this.db
      .prepare("SELECT data FROM activities WHERE workspace_id=? AND id=?")
      .get(workspaceId, id);
    if (!row) throw new HttpError(404, "History record not found");
    return JSON.parse(String(row.data));
  }
  async read<T>(
    table: "projects" | "tasks" | "activities",
    ws: string,
  ): Promise<T[]> {
    return (
      await this.db
        .prepare(
          `SELECT data FROM ${table} WHERE workspace_id=?${table === "activities" ? " ORDER BY created_at DESC,rowid DESC LIMIT 500" : " ORDER BY rowid"}`,
        )
        .all(ws)
    ).map((row) => JSON.parse(String(row.data)) as T);
  }
  async get<T>(
    table: "projects" | "tasks",
    ws: string,
    id: string,
  ): Promise<T> {
    const row = await this.db
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
  async assertProjectWritable(ws: string, id: string) {
    const project = await this.get<Project>("projects", ws, id);
    assertProjectWritable(project);
    return project;
  }
  async putProject(
    ws: string,
    p: Project,
    retained?: Project,
    lifecycleChange = false,
  ) {
    const previous = await this.db
      .prepare("SELECT data FROM projects WHERE workspace_id=? AND id=?")
      .get(ws, p.id);
    const old: Project | undefined = previous
      ? JSON.parse(String(previous.data))
      : undefined;
    if (old && !lifecycleChange) {
      assertProjectWritable(old);
      // Ordinary editors and history restores cannot change lifecycle metadata.
      p.lifecycle = old.lifecycle;
      p.lifecycleChangedAt = old.lifecycleChangedAt;
    }
    Object.assign(
      p,
      projectMembers(
        p,
        await this.members(ws),
        retained ?? (previous ? JSON.parse(String(previous.data)) : undefined),
      ),
    );
    await this.db
      .prepare(
        "INSERT INTO projects(id,workspace_id,version,data) VALUES(?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,data=excluded.data",
      )
      .run(p.id, ws, p.version, JSON.stringify(p));
  }
  async putTask(
    ws: string,
    t: Task,
    retained?: Task,
    options: { preserveAssignment?: boolean; importArchived?: boolean } = {},
  ) {
    const previous = await this.db
      .prepare("SELECT data FROM tasks WHERE workspace_id=? AND id=?")
      .get(ws, t.id);
    const old: Task | undefined = previous
      ? JSON.parse(String(previous.data))
      : undefined;
    if (!options.importArchived) {
      await this.assertProjectWritable(ws, t.projectId);
      if (old && old.projectId !== t.projectId)
        await this.assertProjectWritable(ws, old.projectId);
    }
    t.sortOrder ??=
      old?.projectId === t.projectId && old.parentId === t.parentId
        ? old.sortOrder
        : undefined;
    t.sortOrder ??= nextTaskSortOrder(
      await this.read<Task>("tasks", ws),
      t.projectId,
      t.parentId,
    );
    Object.assign(
      t,
      retainTaskSchedule(
        t,
        previous ? JSON.parse(String(previous.data)) : undefined,
      ),
    );
    if (!options.preserveAssignment)
      Object.assign(
        t,
        taskMember(
          t,
          await this.members(ws),
          retained ??
            (previous ? JSON.parse(String(previous.data)) : undefined),
        ),
      );
    await this.db
      .prepare(
        "INSERT INTO tasks(id,workspace_id,project_id,version,data) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,data=excluded.data,project_id=excluded.project_id",
      )
      .run(t.id, ws, t.projectId, t.version, JSON.stringify(t));
  }
  async audit(ws: string, a: Activity) {
    await this.db
      .prepare(
        "INSERT INTO activities(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
      )
      .run(a.id, ws, a.createdAt, JSON.stringify(a));
  }
  async record(
    actor: Actor,
    kind: Activity["kind"],
    action: string,
    before: Project | Task | null,
    after: Project | Task | null,
    source = "Manual edit",
    progressSource?: Activity["progressSource"],
  ) {
    await this.audit(actor.workspaceId, {
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
      (await this.db
        .prepare("SELECT 1 FROM users WHERE id=? AND workspace_id=?")
        .get(actor.id, actor.workspaceId))
    ) {
      const time = new Date().toISOString();
      await this.db
        .prepare(
          "INSERT INTO project_members(workspace_id,project_id,user_id,joined_at,last_edited_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET last_edited_at=excluded.last_edited_at",
        )
        .run(actor.workspaceId, projectId, actor.id, time, time);
    }
    await this.db
      .prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?")
      .run(actor.workspaceId);
  }
  async validate(ws: string) {
    const s = await this.snapshot(ws);
    validateGraph(s.projects, s.tasks);
  }
}
