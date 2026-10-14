import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  linkSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";

function isInside(root: string, target: string) {
  const child = relative(root, target);
  return (
    !child ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

/** Consistent SQLite/WAL snapshot. Publishes only a verified, private new file. */
export async function backupDatabase(source: string, destination: string) {
  if (source === ":memory:" || !existsSync(source))
    throw new Error("Choose an existing file-backed database");
  const input = realpathSync(source);
  const output = resolve(destination);
  if (existsSync(output)) throw new Error("Backup destination already exists");
  if (isInside(resolve("dist/web"), output))
    throw new Error("Backups cannot be stored in the public web directory");
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const parent = realpathSync(dirname(output));
  const publicRoot = existsSync("dist/web")
    ? realpathSync("dist/web")
    : resolve("dist/web");
  if (isInside(publicRoot, parent))
    throw new Error("Backups cannot be stored in the public web directory");
  const temp = mkdtempSync(join(parent, ".pm-backup-"));
  chmodSync(temp, 0o700);
  const snapshot = join(temp, "snapshot.sqlite");
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(input, { readOnly: true });
    // Do not construct Repository: backing up must never run migrations/seed.
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations'",
        )
        .get()
    )
      throw new Error("Source is not a Project Manage database");
    await backup(db, snapshot);
    chmodSync(snapshot, 0o600);
    const check = new DatabaseSync(snapshot, { readOnly: true });
    try {
      const integrity = check.prepare("PRAGMA integrity_check").all();
      if (
        integrity.length !== 1 ||
        integrity[0]?.integrity_check !== "ok" ||
        check.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("Backup integrity check failed");
    } finally {
      check.close();
    }
    // Atomic no-overwrite publication, even if another writer claimed the name.
    linkSync(snapshot, output);
    return { path: output, integrity: "ok" as const };
  } finally {
    db?.close();
    rmSync(temp, { recursive: true, force: true });
  }
}
