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
import { Repository } from "../../apps/api/src/database";
import { backupDatabase } from "../../apps/api/src/backup";
it("backs up committed WAL data privately, restores independently and never overwrites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-backup-test-"));
  const source = join(dir, "source.sqlite"),
    dest = join(dir, "saved.sqlite");
  const repo = new Repository(source);
  try {
    repo.seed("synthetic");
    const before = repo.snapshot("synthetic");
    const publicDestination = resolve("dist/web/forbidden-backup-test.sqlite");
    await expect(backupDatabase(source, publicDestination)).rejects.toThrow(
      "public web directory",
    );
    expect(existsSync(publicDestination)).toBe(false);
    const dottedDirectory = resolve("dist/web/..private/snapshot.sqlite");
    await expect(backupDatabase(source, dottedDirectory)).rejects.toThrow(
      "public web directory",
    );
    expect(existsSync(dottedDirectory)).toBe(false);
    expect(existsSync(source + "-wal")).toBe(true);
    await expect(backupDatabase(source, dest)).resolves.toEqual({
      path: dest,
      integrity: "ok",
    });
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(dest);
    await expect(backupDatabase(source, dest)).rejects.toThrow(
      "already exists",
    );
    expect(readFileSync(dest)).toEqual(bytes);
    await expect(backupDatabase(source, source)).rejects.toThrow(
      "already exists",
    );
    const alias = join(dir, "alias.sqlite");
    symlinkSync(source, alias);
    await expect(backupDatabase(source, alias)).rejects.toThrow(
      "already exists",
    );
    repo.transaction(() =>
      repo.putProject("synthetic", {
        ...before.projects[0]!,
        name: "Post-backup edit",
        version: 2,
      }),
    );
    const restored = new Repository(dest);
    try {
      expect(restored.snapshot("synthetic")).toEqual(before);
      expect(
        restored.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
    } finally {
      restored.close();
    }
    expect(repo.snapshot("synthetic").projects[0]!.name).toBe(
      "Post-backup edit",
    );
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("refuses missing sources without initializing an empty database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-backup-missing-"));
  try {
    await expect(
      backupDatabase(join(dir, "missing.sqlite"), join(dir, "out.sqlite")),
    ).rejects.toThrow("existing");
    expect(existsSync(join(dir, "missing.sqlite"))).toBe(false);
    expect(existsSync(join(dir, "out.sqlite"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
