import { timedAssembly } from "./performance.js";
import { activityScope } from "../../../packages/domain/activity-query.js";
import {
  emptyVersions,
  type SyncVersions,
  type WorkspaceCore,
  type ReceiptInput,
} from "../../../packages/domain/workspace-sync.js";
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
import { type ActivityQuery } from "../../../packages/domain/activity-query.js";
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

  async syncVersions(ws: string, userId: string): Promise<SyncVersions> {
    const versions = emptyVersions();
    let globalNotifications = "0",
      userNotifications = "0";
    for (const row of await this.db
      .prepare(
        "SELECT domain,user_id,version::text FROM workspace_sync_versions WHERE workspace_id=? AND user_id IN ('',?)",
      )
      .all(ws, userId)) {
      if (row.domain === "notifications") {
        if (row.user_id) userNotifications = String(row.version);
        else globalNotifications = String(row.version);
      } else if (row.domain in versions)
        versions[row.domain as keyof SyncVersions] = String(row.version);
    }
    versions.notifications = `${globalNotifications}.${userNotifications}`;
    return versions;
  }
  async core(workspaceId: string): Promise<WorkspaceCore> {
    return timedAssembly(() =>
      this.db.readSnapshot(async () => {
        const row = await this.db
          .prepare("SELECT revision FROM workspaces WHERE id=?")
          .get(workspaceId);
        if (!row) throw new HttpError(404, "Workspace not found");
        const projects = await this.read<Project>("projects", workspaceId);
        return {
          schemaVersion: 3,
          revision: Number(row.revision),
          projects,
          tasks: await this.read<Task>("tasks", workspaceId),
          catalogs: await this.catalogs(workspaceId),
          settings: await this.settings(workspaceId),
          members: await this.members(workspaceId),
          projectOrder: await this.projectOrder(workspaceId, projects),
        };
      }),
    );
  }
  async receipts(ws: string, input: ReceiptInput): Promise<Activity[]> {
    if (!input.entities.length) return [];
    const rows = await this.db
      .prepare(
        `SELECT a.data FROM activities a
      WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset(?::jsonb) AS requested(kind text,id text,version text)
        WHERE a.data::jsonb->>'kind'=requested.kind AND a.data::jsonb->>'entityId'=requested.id
        AND a.data::jsonb->'after'->>'version'=requested.version)
      AND a.workspace_id=? ORDER BY a.occurred_at DESC,a.id COLLATE "C" ASC`,
      )
      .all(JSON.stringify(input.entities), ws);
    return rows.map((row) => ({
      ...JSON.parse(String(row.data)),
      progressSource: undefined,
    }));
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
    const core = await this.core(workspaceId);
    const directory = await this.directory(workspaceId);
    return {
      ...core,
      activities: (await this.read<Activity>("activities", workspaceId)).map(
        (a) => (includeSources ? a : { ...a, progressSource: undefined }),
      ),
      directory,
      projectMembers: await this.projectMembers(
        workspaceId,
        undefined,
        directory,
      ),
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
  async projectOrder(ws: string, projects?: Project[]) {
    const row = await this.db
      .prepare("SELECT data FROM workspace_project_order WHERE workspace_id=?")
      .get(ws);
    return orderedProjectIds(
      projects ?? (await this.read<Project>("projects", ws)),
      row ? JSON.parse(String(row.data)) : [],
    );
  }
  async projectMembers(
    workspaceId: string,
    projectId?: string,
    cachedDirectory?: CompanyDirectory,
  ): Promise<ProjectMember[]> {
    const directory = cachedDirectory ?? (await this.directory(workspaceId));
    return (
      await this.db
        .prepare(
          "SELECT project_id,user_id,users.name,joined_at,last_edited_at FROM project_members JOIN users ON users.id=project_members.user_id WHERE project_members.workspace_id=? AND (?::text IS NULL OR project_id=?) ORDER BY joined_at,user_id",
        )
        .all(workspaceId, projectId ?? null, projectId ?? null)
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
    const scope = activityScope(query);
    if (
      [query.cursor, query.checkpoint].some(
        (point) => point && point.scope !== scope,
      )
    )
      throw new HttpError(
        400,
        "Activity filters changed. Reload the first page.",
      );
    if (Date.parse(asOf) > Date.now())
      throw new HttpError(400, "History cutoff cannot be in the future");
    const where = `workspace_id=? AND rowid<=? AND occurred_at>=?::timestamptz
      AND occurred_at<?::timestamptz AND occurred_at<=?::timestamptz
      AND (NOT ?::boolean OR data::jsonb->>'source' IS DISTINCT FROM 'Synthetic demo seed')
      AND (?::text[] IS NULL OR data::jsonb->>'projectId'=ANY(?::text[]))
      AND (?='' OR strpos(lower(concat(data::jsonb->>'actor',' ',data::jsonb->>'action',' ',data::jsonb->>'source',' ',
        CASE WHEN data::jsonb->'after'='null'::jsonb THEN '""' ELSE (data::json->'after')::text END)),?)>0)`;
    const search = query.search?.trim().toLowerCase() ?? "";
    const values = [
      workspaceId,
      through,
      start,
      end,
      asOf,
      !!query.excludeSeed,
      query.projectIds ?? null,
      query.projectIds ?? null,
      search,
      search,
    ];
    const completion = `data::jsonb->>'kind'='task'
      AND data::jsonb->>'source' IS DISTINCT FROM 'History restore'
      AND data::jsonb->>'action' IS DISTINCT FROM 'Restored previous version'
      AND data::jsonb->'before'->>'id'=data::jsonb->>'entityId'
      AND data::jsonb->'after'->>'id'=data::jsonb->>'entityId'
      AND data::jsonb->'before'->>'projectId'=data::jsonb->'after'->>'projectId'
      AND data::jsonb->'after'->>'projectId'=COALESCE(data::jsonb->>'originalProjectId',data::jsonb->>'projectId')
      AND (data::jsonb->'after'->>'version')::bigint>(data::jsonb->'before'->>'version')::bigint
      AND data::jsonb->'before'->>'status'<>'done' AND data::jsonb->'after'->>'status'='done'`;
    const counts = (await this.db
      .prepare(
        `SELECT COUNT(*) AS total,
      COUNT(DISTINCT NULLIF(data::jsonb->>'projectId','')) AS projects,
      COUNT(DISTINCT CASE WHEN ${completion} THEN concat(data::jsonb->>'entityId',':',data::jsonb->'before'->>'version',':',data::jsonb->'after'->>'version') END) AS completions
      FROM activities WHERE ${where}`,
      )
      .get(...values))!;
    if (exportAll && Number(counts.total) > 10000)
      throw new HttpError(
        400,
        "Export up to 10000 events at a time. Narrow the history filters.",
      );
    const limit = exportAll ? 10000 : (query.limit ?? 25);
    const cursor = !exportAll && query.cursor;
    const rows = await this.db
      .prepare(
        `SELECT data FROM activities WHERE ${where}
      ${cursor ? 'AND (occurred_at<?::timestamptz OR (occurred_at=?::timestamptz AND id COLLATE "C">?))' : ""}
      ORDER BY occurred_at DESC,id COLLATE "C" ASC LIMIT ?`,
      )
      .all(
        ...values,
        ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        limit + 1,
      );
    const more = rows.length > limit;
    const events = rows
      .slice(0, limit)
      .map((row) => JSON.parse(String(row.data)) as Activity);
    const days = bounds ? bounds.days.map((date) => ({ date, count: 0 })) : [];
    if (bounds) {
      const dayRows = await this.db
        .prepare(
          `SELECT to_char(occurred_at AT TIME ZONE ?, 'YYYY-MM-DD') AS day, COUNT(*) AS count FROM activities WHERE ${where} GROUP BY day`,
        )
        .all(timeZone, ...values);
      for (const day of days)
        day.count = Number(
          dayRows.find((row) => row.day === day.date)?.count ?? 0,
        );
    }
    const last = events.at(-1);
    return {
      events,
      total: Number(counts.total),
      projectCount: Number(counts.projects),
      completionActions: Number(counts.completions),
      days,
      weekStart: query.weekStart ?? null,
      timeZone,
      bounds: bounds ? { start: bounds.start, end: bounds.end } : null,
      checkpoint: { scope, through, asOf },
      asOf,
      nextCursor:
        more && last
          ? { scope, through, asOf, createdAt: last.createdAt, id: last.id }
          : null,
    };
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
