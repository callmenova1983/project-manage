import { it, expect } from "vitest";
import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository } from "../../apps/api/src/database";
import { createSeed } from "../../packages/domain/seed";
import { backupDatabase } from "../../apps/api/src/backup";

it("upgrades a synthetic v3 database without changing users/projects and restores a consistent pre-upgrade backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-upgrade-")),
    path = join(dir, "workspace.sqlite"),
    backupPath = join(dir, "before.sqlite"),
    restoredPath = join(dir, "restored.sqlite");
  try {
    const old = new DatabaseSync(path);
    old.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    for (const file of readdirSync("apps/api/migrations")
      .filter((f) => /^[0-3]_/.test(f) || /^00[1-3]_/.test(f))
      .sort()) {
      old.exec(readFileSync(join("apps/api/migrations", file), "utf8"));
      old
        .prepare(
          "INSERT OR IGNORE INTO migrations(version,applied_at) VALUES(?,?)",
        )
        .run(Number(file.split("_")[0]), "2026-10-11T00:00:00Z");
    }
    old
      .prepare("INSERT INTO workspaces(id,name) VALUES(?,?)")
      .run("synthetic", "Synthetic workspace");
    old
      .prepare(
        "INSERT INTO users(id,workspace_id,email,name,password_hash) VALUES(?,?,?,?,?)",
      )
      .run(
        "synthetic-user",
        "synthetic",
        "fixture@example.test",
        "Synthetic member",
        "nonfunctional synthetic hash",
      );
    const p = createSeed().projects[0]!;
    old
      .prepare(
        "INSERT INTO projects(id,workspace_id,version,data) VALUES(?,?,?,?)",
      )
      .run(p.id, "synthetic", p.version, JSON.stringify(p));
    const originalUser = old.prepare("SELECT * FROM users").get(),
      originalProject = old.prepare("SELECT * FROM projects").get();
    // The backup API includes committed WAL content, without copying only the main file.
    await backup(old, backupPath);
    old.close();
    const upgraded = new Repository(path);
    expect(
      upgraded.db
        .prepare("SELECT version FROM migrations ORDER BY version")
        .all()
        .map((r) => r.version),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(upgraded.db.prepare("SELECT * FROM users").get()).toMatchObject({
      ...originalUser,
      role: "member",
      status: "active",
      requires_activation: 0,
    });
    expect(upgraded.db.prepare("SELECT * FROM projects").get()).toEqual(
      originalProject,
    );
    expect(upgraded.db.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(upgraded.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    upgraded.close();
    copyFileSync(backupPath, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    expect(
      restored.prepare("SELECT max(version) AS version FROM migrations").get()!
        .version,
    ).toBe(3);
    expect(restored.prepare("SELECT * FROM users").get()).toEqual(originalUser);
    expect(restored.prepare("SELECT * FROM projects").get()).toEqual(
      originalProject,
    );
    expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("adds the v6 history index without rewriting v5 business data and restores the pre-upgrade snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-v6-upgrade-")),
    path = join(dir, "db.sqlite"),
    saved = join(dir, "v5.sqlite");
  try {
    const initial = new Repository(path);
    initial.seed("synthetic");
    initial.db.exec(
      "DROP INDEX activity_workspace_instant; DELETE FROM migrations WHERE version=6;",
    );
    const before = initial.snapshot("synthetic");
    await backupDatabase(path, saved);
    initial.close();
    const upgraded = new Repository(path);
    expect(upgraded.snapshot("synthetic")).toEqual(before);
    expect(
      upgraded.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='activity_workspace_instant'",
        )
        .get(),
    ).toBeTruthy();
    const plan = upgraded.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT data FROM activities WHERE workspace_id=? AND julianday(created_at)>=julianday(?) ORDER BY julianday(created_at) DESC,id",
      )
      .all("synthetic", "2020-01-01");
    expect(JSON.stringify(plan)).toContain("activity_workspace_instant");
    upgraded.db.exec(
      "BEGIN; DROP INDEX activity_workspace_instant; DELETE FROM migrations WHERE version=6; COMMIT;",
    );
    expect(upgraded.snapshot("synthetic")).toEqual(before);
    upgraded.close();
    const reapplied = new Repository(path);
    expect(reapplied.snapshot("synthetic")).toEqual(before);
    reapplied.close();
    const restored = new DatabaseSync(saved, { readOnly: true });
    expect(
      restored.prepare("SELECT MAX(version) AS version FROM migrations").get()!
        .version,
    ).toBe(5);
    expect(
      restored
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='activity_workspace_instant'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      restored.prepare("SELECT COUNT(*) AS n FROM projects").get()!.n,
    ).toBe(before.projects.length);
    expect(
      restored.prepare("PRAGMA integrity_check").get()!.integrity_check,
    ).toBe("ok");
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
