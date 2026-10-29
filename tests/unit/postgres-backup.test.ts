import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseConfig } from "../../apps/api/src/database-config";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../apps/api/src/postgres.js", () => ({
  PostgresDatabase: class {
    query = mocks.query;
    close = mocks.close;
  },
}));
import { backupDatabase } from "../../apps/api/src/backup";

let root: string;
let config: DatabaseConfig;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pm-pg-backup-"));
  config = {
    type: "postgres",
    host: "database.example.test",
    port: 5432,
    database: "test",
    user: "test",
    password: "synthetic-secret-do-not-print",
    schema: "public",
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 3000,
    credentialKeyPath: join(root, "credentials.key"),
  };
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.spawn.mockReset().mockImplementation((_command, args) => {
    const child = new EventEmitter();
    queueMicrotask(() => {
      const output = args.find((arg: string) => arg.startsWith("--file="));
      if (output) writeFileSync(output.slice(7), "synthetic-pg-custom-archive");
      child.emit("close", 0);
    });
    return child;
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("PostgreSQL backups", () => {
  it("publishes a private archive and original key without credentials in arguments", async () => {
    const key = Buffer.alloc(32, 7);
    writeFileSync(config.credentialKeyPath, key);
    const output = join(root, "snapshot.dump");
    const result = await backupDatabase(config, output);
    expect(result).toEqual({
      path: output,
      format: "postgres-custom",
      verification: "archive-readable",
      credentialKeyPath: `${output}.credentials-key`,
    });
    expect(readFileSync(`${output}.credentials-key`)).toEqual(key);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(statSync(`${output}.credentials-key`).mode & 0o777).toBe(0o600);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    const [command, args, options] = mocks.spawn.mock.calls[0]!;
    expect(command).toBe("pg_dump");
    expect(args.join(" ")).not.toContain(config.password);
    expect(options.env.PGPASSWORD).toBe(config.password);
    expect(options.env.PGDATABASE).toBe(config.database);
    expect(options.env.PGSSLMODE).toBe("disable");
    await expect(backupDatabase(config, output)).rejects.toThrow(
      "already exists",
    );
  });

  it("rejects public destinations and missing encrypted credential keys", async () => {
    await expect(
      backupDatabase(config, resolve("dist/web/unsafe.dump")),
    ).rejects.toThrow("public web directory");
    mocks.query.mockResolvedValue({ rows: [{ present: 1 }] });
    const output = join(root, "missing-key.dump");
    await expect(backupDatabase(config, output)).rejects.toThrow(
      "key is missing",
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(existsSync(output)).toBe(false);
  });

  it("does not publish an archive when dump fails", async () => {
    const output = join(root, "failed.dump");
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 1));
      return child;
    });
    await expect(backupDatabase(config, output)).rejects.toThrow(
      "pg_dump failed",
    );
    expect(existsSync(output)).toBe(false);
    expect(existsSync(`${output}.credentials-key`)).toBe(false);
  });

  it("does not publish an archive that pg_restore cannot read", async () => {
    const output = join(root, "unreadable.dump");
    const normal = mocks.spawn.getMockImplementation()!;
    mocks.spawn.mockImplementation((command, args, options) => {
      if (command !== "pg_restore") return normal(command, args, options);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 1));
      return child;
    });
    await expect(backupDatabase(config, output)).rejects.toThrow(
      "pg_restore failed",
    );
    expect(existsSync(output)).toBe(false);
  });

  it("uses verified TLS and a private CA file when configured", async () => {
    config.ssl = { rejectUnauthorized: true, ca: "synthetic CA" };
    const normal = mocks.spawn.getMockImplementation()!;
    mocks.spawn.mockImplementation((command, args, options) => {
      expect(options.env.PGSSLMODE).toBe("verify-full");
      expect(readFileSync(options.env.PGSSLROOTCERT, "utf8")).toBe(
        "synthetic CA",
      );
      return normal(command, args, options);
    });
    await backupDatabase(config, join(root, "tls.dump"));
  });
});
