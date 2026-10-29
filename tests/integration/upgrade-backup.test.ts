import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository } from "../../apps/api/src/database.js";
import { readDatabaseConfig } from "../../apps/api/src/database-config.js";
import { migrateSqlite } from "../../apps/api/src/migrate-sqlite.js";
import { createSeed } from "../../packages/domain/seed.js";

function sourceFixture(path: string, maximum = 22) {
  const source = new DatabaseSync(path);
  for (const file of readdirSync("apps/api/migrations")
    .filter(
      (name) =>
        /^\d+_.+\.sql$/.test(name) && Number(name.split("_")[0]) <= maximum,
    )
    .sort()) {
    source.exec(readFileSync(join("apps/api/migrations", file), "utf8"));
    source
      .prepare(
        "INSERT OR IGNORE INTO migrations(version,applied_at) VALUES(?,?)",
      )
      .run(Number(file.split("_")[0]), "2026-10-01T00:00:00Z");
  }
  source
    .prepare("INSERT INTO workspaces(id,name) VALUES(?,?)")
    .run("synthetic", "Synthetic migration fixture");
  source
    .prepare(
      "INSERT INTO users(id,workspace_id,email,name,password_hash) VALUES(?,?,?,?,?)",
    )
    .run(
      "user",
      "synthetic",
      "migration@example.test",
      "Synthetic member",
      "unchanged synthetic password hash",
    );
  const project = createSeed().projects[0]!;
  source
    .prepare(
      "INSERT INTO projects(id,workspace_id,version,data) VALUES(?,?,?,?)",
    )
    .run(project.id, "synthetic", project.version, JSON.stringify(project));
  return { source, project };
}

it("imports every SQLite table losslessly, preserving identifiers, blobs, credentials, cursor order and a private recovery copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-pg-import-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  const sourcePath = join(dir, "source.sqlite");
  const config = {
    ...readDatabaseConfig(),
    schema: repo.db.schema,
    credentialKeyPath: join(dir, "pg.key"),
  };
  const { source, project } = sourceFixture(sourcePath);
  const key = randomBytes(32);
  const bytes = Buffer.from([0, 255, 35, 12, 200, 0]);
  try {
    source
      .prepare("UPDATE users SET username='syntheticm' WHERE id='user'")
      .run();
    source
      .prepare(
        "UPDATE workspaces SET time_zone='Asia/Shanghai',settings_version=3",
      )
      .run();
    source
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run("synthetic-token-hash", "user", "csrf", 1900000000000);
    source
      .prepare(
        "INSERT INTO workspace_ai_credentials(workspace_id,encrypted_config) VALUES(?,?)",
      )
      .run("synthetic", "opaque synthetic ciphertext");
    source
      .prepare(
        "INSERT INTO progress_materials(id,workspace_id,project_id,created_at,metadata,bytes,images) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "material",
        "synthetic",
        project.id,
        "2026-10-01T00:00:00Z",
        "{}",
        bytes,
        "[]",
      );
    source
      .prepare(
        "INSERT INTO activities(rowid,id,workspace_id,created_at,data) VALUES(?,?,?,?,?)",
      )
      .run(25, "activity", "synthetic", "2026-10-01T00:00:00Z", "{}");
    source
      .prepare(
        "INSERT INTO notification_cursors(workspace_id,activity_row,initialized_at) VALUES(?,?,?)",
      )
      .run("synthetic", 25, "2026-10-01T00:00:00Z");
    writeFileSync(`${sourcePath}.credentials-key`, key, { mode: 0o600 });
    const dryRun = await migrateSqlite({ source: sourcePath, config });
    expect(dryRun.mode).toBe("dry-run");
    expect(
      (await repo.db.prepare("SELECT COUNT(*) AS n FROM workspaces").get())!.n,
    ).toBe(0);
    expect(existsSync(config.credentialKeyPath)).toBe(false);
    const result = await migrateSqlite({
      source: sourcePath,
      config,
      apply: true,
      backupDirectory: join(dir, "backups"),
    });
    expect(result.mode).toBe("applied");
    if (result.mode !== "applied" || !("backup" in result))
      throw new Error("Expected applied migration");
    expect(
      result.tables.every((table) => "verified" in table && table.verified),
    ).toBe(true);
    expect(readFileSync(config.credentialKeyPath)).toEqual(key);
    expect(readFileSync(`${result.backup}.credentials-key`)).toEqual(key);
    expect(
      (await repo.db.prepare("SELECT bytes FROM progress_materials").get())!
        .bytes,
    ).toEqual(bytes);
    expect(
      (await repo.db.prepare("SELECT password_hash FROM users").get())!
        .password_hash,
    ).toBe("unchanged synthetic password hash");
    expect(
      (await repo.db.prepare("SELECT expires_at FROM sessions").get())!
        .expires_at,
    ).toBe(1900000000000);
    expect(
      (await repo.db
        .prepare("SELECT activity_row FROM notification_cursors")
        .get())!.activity_row,
    ).toBe(25);
    expect(await repo.settings("synthetic")).toEqual({
      timeZone: "Asia/Shanghai",
      version: 3,
    });
    const next = (
      await repo.db.query(
        "INSERT INTO activities(id,workspace_id,created_at,data) VALUES('next','synthetic','2026-10-02','{}') RETURNING rowid",
      )
    ).rows[0]!;
    expect(Number(next.rowid)).toBeGreaterThan(25);
    const recovery = new DatabaseSync(result.backup!, { readOnly: true });
    try {
      expect(
        recovery.prepare("SELECT rowid FROM activities").get()!.rowid,
      ).toBe(25);
      expect(
        recovery.prepare("PRAGMA integrity_check").get()!.integrity_check,
      ).toBe("ok");
      expect(
        recovery.prepare("SELECT password_hash FROM users").get()!
          .password_hash,
      ).toBe("unchanged synthetic password hash");
    } finally {
      recovery.close();
    }
  } finally {
    source.close();
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects nonempty PostgreSQL targets without changing source or target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-pg-import-existing-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  const sourcePath = join(dir, "source.sqlite");
  const { source } = sourceFixture(sourcePath);
  try {
    await repo.workspace("existing", "Existing data");
    const config = {
      ...readDatabaseConfig(),
      schema: repo.db.schema,
      credentialKeyPath: join(dir, "pg.key"),
    };
    await expect(
      migrateSqlite({ source: sourcePath, config, apply: true }),
    ).rejects.toThrow("not empty");
    expect(
      (await repo.db.prepare("SELECT id FROM workspaces").all()).map(
        (row) => row.id,
      ),
    ).toEqual(["existing"]);
    expect(source.prepare("SELECT COUNT(*) AS n FROM projects").get()!.n).toBe(
      1,
    );
  } finally {
    source.close();
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses to replace another credential key before importing encrypted settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-pg-import-key-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  const sourcePath = join(dir, "source.sqlite");
  const { source } = sourceFixture(sourcePath);
  try {
    const config = {
      ...readDatabaseConfig(),
      schema: repo.db.schema,
      credentialKeyPath: join(dir, "pg.key"),
    };
    writeFileSync(`${sourcePath}.credentials-key`, randomBytes(32), {
      mode: 0o600,
    });
    const existingKey = randomBytes(32);
    writeFileSync(config.credentialKeyPath, existingKey, { mode: 0o600 });
    await expect(
      migrateSqlite({ source: sourcePath, config, apply: true }),
    ).rejects.toThrow("differs");
    expect(readFileSync(config.credentialKeyPath)).toEqual(existingKey);
    expect(
      (await repo.db.prepare("SELECT COUNT(*) AS n FROM projects").get())!.n,
    ).toBe(0);
  } finally {
    source.close();
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses incompatible legacy schemas transactionally and preserves the pre-import SQLite backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-pg-import-v3-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  const sourcePath = join(dir, "source.sqlite");
  const { source } = sourceFixture(sourcePath, 3);
  try {
    const original = source.prepare("SELECT * FROM users").all();
    const config = {
      ...readDatabaseConfig(),
      schema: repo.db.schema,
      credentialKeyPath: join(dir, "pg.key"),
    };
    await expect(
      migrateSqlite({
        source: sourcePath,
        config,
        apply: true,
        backupDirectory: join(dir, "backups"),
      }),
    ).rejects.toThrow("table sets differ");
    expect(
      (await repo.db.prepare("SELECT COUNT(*) AS n FROM users").get())!.n,
    ).toBe(0);
    expect(source.prepare("SELECT * FROM users").all()).toEqual(original);
    const backup = readdirSync(join(dir, "backups")).find((name) =>
      name.endsWith(".sqlite"),
    )!;
    const recovery = new DatabaseSync(join(dir, "backups", backup), {
      readOnly: true,
    });
    try {
      expect(recovery.prepare("SELECT * FROM users").all()).toEqual(original);
    } finally {
      recovery.close();
    }
  } finally {
    source.close();
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("accepts only the known migration-022 variant missing enterprise session bindings and leaves that PG table empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-pg-import-v22-variant-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  const sourcePath = join(dir, "source.sqlite");
  const { source } = sourceFixture(sourcePath);
  try {
    source.exec("DROP TABLE wecom_login_sessions");
    const before = source.prepare("SELECT * FROM users").all();
    const config = {
      ...readDatabaseConfig(),
      schema: repo.db.schema,
      credentialKeyPath: join(dir, "pg.key"),
    };
    const dryRun = await migrateSqlite({ source: sourcePath, config });
    expect(dryRun.newEmptyTables).toEqual(["wecom_login_sessions"]);
    const result = await migrateSqlite({
      source: sourcePath,
      config,
      apply: true,
      backupDirectory: join(dir, "backups"),
    });
    expect(result.mode).toBe("applied");
    expect(result.newEmptyTables).toEqual(["wecom_login_sessions"]);
    expect(
      (await repo.db
        .prepare("SELECT COUNT(*) AS n FROM wecom_login_sessions")
        .get())!.n,
    ).toBe(0);
    expect(
      (await repo.db.prepare("SELECT COUNT(*) AS n FROM projects").get())!.n,
    ).toBe(1);
    expect(source.prepare("SELECT * FROM users").all()).toEqual(before);
    expect(
      source
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='wecom_login_sessions'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    source.close();
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["unknown source table", "another missing table"])(
  "still rejects the known variant with %s",
  async (difference) => {
    const dir = mkdtempSync(join(tmpdir(), "pm-pg-import-unknown-"));
    const repo = await Repository.open(readDatabaseConfig(), {
      isolated: true,
    });
    const sourcePath = join(dir, "source.sqlite");
    const { source } = sourceFixture(sourcePath);
    try {
      source.exec("DROP TABLE wecom_login_sessions");
      source.exec(
        difference === "unknown source table"
          ? "CREATE TABLE unknown_source_table(id TEXT)"
          : "DROP TABLE wecom_login_events",
      );
      const config = {
        ...readDatabaseConfig(),
        schema: repo.db.schema,
        credentialKeyPath: join(dir, "pg.key"),
      };
      await expect(
        migrateSqlite({
          source: sourcePath,
          config,
          apply: true,
          backupDirectory: join(dir, "backups"),
        }),
      ).rejects.toThrow("table sets differ");
      expect(
        (await repo.db.prepare("SELECT COUNT(*) AS n FROM users").get())!.n,
      ).toBe(0);
      expect(source.prepare("SELECT COUNT(*) AS n FROM users").get()!.n).toBe(
        1,
      );
    } finally {
      source.close();
      await repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
