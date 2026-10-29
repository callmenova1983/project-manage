import { it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Repository } from "../../apps/api/src/database.js";
import { backupDatabase } from "../../apps/api/src/backup.js";
import { readDatabaseConfig } from "../../apps/api/src/database-config.js";

function comparable(snapshot: Awaited<ReturnType<Repository["snapshot"]>>) {
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((left, right) => left.id.localeCompare(right.id));
  return {
    ...snapshot,
    projects: byId(snapshot.projects),
    tasks: byId(snapshot.tasks),
    activities: byId(snapshot.activities),
  };
}

it("backs up PostgreSQL privately, restores committed data and never overwrites existing files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-backup-test-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  const config = {
    ...readDatabaseConfig(),
    schema: repo.db.schema,
    credentialKeyPath: join(dir, "unused.key"),
  };
  const dest = join(dir, "saved.dump");
  try {
    await repo.seed("synthetic");
    const before = await repo.snapshot("synthetic");
    const publicDestination = resolve("dist/web/forbidden-backup-test.dump");
    await expect(backupDatabase(config, publicDestination)).rejects.toThrow(
      "public web directory",
    );
    expect(existsSync(publicDestination)).toBe(false);
    const dottedDirectory = resolve("dist/web/..private/snapshot.dump");
    await expect(backupDatabase(config, dottedDirectory)).rejects.toThrow(
      "public web directory",
    );
    expect(existsSync(dottedDirectory)).toBe(false);
    await expect(backupDatabase(config, dest)).resolves.toMatchObject({
      path: dest,
      format: "postgres-custom",
      verification: "archive-readable",
    });
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(dest);
    await expect(backupDatabase(config, dest)).rejects.toThrow(
      "already exists",
    );
    expect(readFileSync(dest)).toEqual(bytes);
    const alias = join(dir, "alias.dump");
    symlinkSync(dest, alias);
    await expect(backupDatabase(config, alias)).rejects.toThrow(
      "already exists",
    );
    const project = before.projects[0]!;
    await repo.transaction(() =>
      repo.putProject("synthetic", {
        ...project,
        name: "Post-backup edit",
        version: 2,
      }),
    );
    expect(
      (await repo.snapshot("synthetic")).projects.find(
        (row) => row.id === project.id,
      )!.name,
    ).toBe("Post-backup edit");
    // The archive contains only this disposable schema, never public or user data.
    expect(config.schema).toMatch(/^pm_test_/);
    execFileSync(
      "pg_restore",
      [
        "--no-password",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--dbname",
        config.database,
        dest,
      ],
      {
        timeout: 15000,
        stdio: "pipe",
        env: {
          PATH: process.env.PATH,
          PGHOST: config.host,
          PGPORT: String(config.port),
          PGUSER: config.user,
          PGPASSWORD: config.password,
          PGSSLMODE: config.ssl ? "verify-full" : "disable",
        },
      },
    );
    expect(comparable(await repo.snapshot("synthetic"))).toEqual(
      comparable(before),
    );
  } finally {
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses an uninitialized PostgreSQL schema without creating application tables or a backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-backup-missing-"));
  const repo = await Repository.open(readDatabaseConfig(), { isolated: true });
  try {
    const missingSchema = `${repo.db.schema}_missing`;
    await expect(
      backupDatabase(
        {
          ...readDatabaseConfig(),
          schema: missingSchema,
          credentialKeyPath: join(dir, "none.key"),
        },
        join(dir, "out.dump"),
      ),
    ).rejects.toThrow();
    expect(existsSync(join(dir, "out.dump"))).toBe(false);
    expect(
      (
        await repo.db.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [
          missingSchema,
        ])
      ).rows,
    ).toEqual([]);
  } finally {
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
