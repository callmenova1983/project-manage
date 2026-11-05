import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const state = vi.hoisted(() => ({
  clients: [] as Array<{
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }>,
  config: undefined as Record<string, unknown> | undefined,
  respond: (() => ({ rows: [], rowCount: 0 })) as (
    sql: string,
    values?: unknown[],
  ) => { rows: unknown[]; rowCount: number },
}));

vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(config: Record<string, unknown>) {
        state.config = config;
      }
      on() {}
      async connect() {
        const client = {
          query: vi.fn(async (sql: string, values?: unknown[]) =>
            state.respond(sql, values),
          ),
          release: vi.fn(),
        };
        state.clients.push(client);
        return client;
      }
      async end() {}
    },
    types: { getTypeParser: () => (value: string) => value },
  },
}));

import {
  parsePostgresInteger,
  PostgresDatabase,
  postgresPlaceholders,
} from "../../apps/api/src/postgres";

beforeEach(() => {
  state.clients.length = 0;
  state.config = undefined;
  state.respond = () => ({ rows: [], rowCount: 0 });
});

describe("PostgreSQL parameters", () => {
  it("rewrites only anonymous parameters outside literals and nested comments", () => {
    const sql = `SELECT '?', "?", 'it''s ?', $$?$$, $body$'?'$body$, ?
      -- ?
      /* ? /* ? */ ? */ WHERE id=? AND data ?? 'key' AND data ?| array['?']`;
    expect(postgresPlaceholders(sql))
      .toBe(`SELECT '?', "?", 'it''s ?', $$?$$, $body$'?'$body$, $1
      -- ?
      /* ? /* ? */ ? */ WHERE id=$2 AND data ? 'key' AND data ?| array['?']`);
  });

  it("honors PostgreSQL escape strings and keeps existing numbered parameters", () => {
    expect(postgresPlaceholders(String.raw`SELECT E'it\'s ?', ?, name$1`)).toBe(
      String.raw`SELECT E'it\'s ?', $1, name$1`,
    );
    expect(postgresPlaceholders("SELECT $1, '$2'")).toBe("SELECT $1, '$2'");
    expect(() => postgresPlaceholders("SELECT $1, ?")).toThrow(/mix/);
  });

  it.each([
    "SELECT 'missing",
    'SELECT "missing',
    "SELECT $tag$missing",
    "/* missing",
  ])("rejects unterminated SQL instead of silently rewriting it: %s", (sql) => {
    expect(() => postgresPlaceholders(sql)).toThrow(/Unterminated/);
  });

  it("does not truncate integers beyond JavaScript's exact range", () => {
    expect(parsePostgresInteger("1793000000000")).toBe(1793000000000);
    expect(parsePostgresInteger("9007199254740993")).toBe("9007199254740993");
  });

  it("preserves JSON path operators and non-ASCII SQL identifiers/dollar quotes", () => {
    expect(
      postgresPlaceholders(
        "SELECT 文档$列, $正文$?$正文$, data @? '$.items', ?",
      ),
    ).toBe("SELECT 文档$列, $正文$?$正文$, data @? '$.items', $1");
  });
});

describe("PostgreSQL connections and transactions", () => {
  it("uses one connection throughout an awaited transaction and releases it after commit", async () => {
    const db = new PostgresDatabase({ schema: "test_pg" });
    state.respond = (sql) => ({
      rows: sql.startsWith("SELECT name") ? [{ name: "name" }] : [],
      rowCount: 1,
    });
    const result = await db.transaction(async () => {
      expect(
        await db.prepare("SELECT name FROM users WHERE id=?").get("u"),
      ).toEqual({ name: "name" });
      await Promise.resolve();
      return await db
        .prepare("UPDATE users SET name=? WHERE id=?")
        .run("new", "u");
    });
    expect(result).toEqual({ changes: 1 });
    expect(state.clients).toHaveLength(1);
    const client = state.clients[0]!;
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SELECT set_config('search_path', $1, false)",
      "BEGIN",
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      "SELECT name FROM users WHERE id=$1",
      "UPDATE users SET name=$1 WHERE id=$2",
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
    await db.close();
  });

  it("reads a consistent snapshot on one connection and reuses an existing write transaction", async () => {
    const db = new PostgresDatabase({ schema: "test_pg" });
    await db.readSnapshot(async () => {
      await db.prepare("SELECT revision FROM workspaces").get();
      await db.readSnapshot(() =>
        db.prepare("SELECT data FROM projects").all(),
      );
    });
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]!.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SELECT set_config('search_path', $1, false)",
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT revision FROM workspaces",
      "SELECT data FROM projects",
      "COMMIT",
    ]);
    await db.transaction(() =>
      db.readSnapshot(() => db.prepare("SELECT data FROM projects").all()),
    );
    expect(state.clients).toHaveLength(2);
    await db.close();
  });

  it("rolls back errors without committing partially completed work", async () => {
    const db = new PostgresDatabase({ schema: "test_pg" });
    const failure = new Error("rejected mutation");
    await expect(
      db.transaction(async () => {
        await db.prepare("UPDATE users SET name=?").run("new");
        throw failure;
      }),
    ).rejects.toBe(failure);
    const statements = state.clients[0]!.query.mock.calls.map(([sql]) => sql);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(state.clients[0]!.release).toHaveBeenCalledWith(false);
  });

  it("keeps concurrent request contexts on separate clients", async () => {
    const db = new PostgresDatabase({ schema: "test_pg" });
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = db.transaction(async () => {
      await db.prepare("SELECT ? AS request").get("first");
      await gate;
      await db.prepare("SELECT ? AS request").get("first-again");
    });
    const second = db.transaction(async () => {
      await db.prepare("SELECT ? AS request").get("second");
      releaseFirst();
    });
    await Promise.all([first, second]);
    expect(state.clients).toHaveLength(2);
    const values = state.clients.map((client) =>
      client.query.mock.calls
        .filter(([sql]) => sql === "SELECT $1 AS request")
        .map(([, params]) => params),
    );
    expect(values).toEqual([[["first"], ["first-again"]], [["second"]]]);
  });

  it("rejects nested transactions and untrusted schema identifiers", async () => {
    const db = new PostgresDatabase({ schema: "test_pg" });
    await expect(
      db.transaction(() => db.transaction(() => undefined)),
    ).rejects.toThrow(/Nested/);
    for (const schema of [
      "public; DROP SCHEMA public",
      "pg_catalog",
      "information_schema",
      "",
    ])
      expect(() => new PostgresDatabase({ schema })).toThrow(/schema/);
  });

  it("refuses to initialize an unknown populated schema", async () => {
    const db = new PostgresDatabase({ schema: "existing" });
    state.respond = (sql) => ({
      rows: sql.includes("FROM pg_class")
        ? [{ name: "someone_elses_data" }]
        : [],
      rowCount: 0,
    });
    await expect(db.initialize()).rejects.toThrow(/not empty/);
    const statements = state.clients[0]!.query.mock.calls.map(
      ([sql]) => sql as string,
    );
    expect(
      statements.some((sql) => /CREATE|DROP|DELETE|TRUNCATE/.test(sql)),
    ).toBe(false);
    expect(statements).toContain("ROLLBACK");
  });

  it("checks migration checksums and leaves an initialized schema untouched", async () => {
    const db = new PostgresDatabase({ schema: "known" });
    const migrations = readdirSync("apps/api/migrations-postgres")
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .map((file) => ({
        version: Number(file.split("_")[0]),
        checksum: createHash("sha256")
          .update(readFileSync(`apps/api/migrations-postgres/${file}`))
          .digest("hex"),
      }));
    state.respond = (sql) => ({
      rows: sql.includes("FROM pg_class")
        ? [{ name: "pm_schema_migrations" }]
        : sql.includes("FROM pm_schema_migrations")
          ? migrations
          : [],
      rowCount: 0,
    });
    await db.initialize();
    const statements = state.clients[0]!.query.mock.calls.map(
      ([sql]) => sql as string,
    );
    expect(statements.some((sql) => sql.includes("CREATE TABLE"))).toBe(false);
    expect(statements).toContain("COMMIT");
  });

  it("rejects changed migration history before applying any table changes", async () => {
    const db = new PostgresDatabase({ schema: "known" });
    state.respond = (sql) => ({
      rows: sql.includes("FROM pg_class")
        ? [{ name: "pm_schema_migrations" }]
        : sql.includes("FROM pm_schema_migrations")
          ? [{ version: 1, checksum: "modified" }]
          : [],
      rowCount: 0,
    });
    await expect(db.initialize()).rejects.toThrow(/history/);
    const statements = state.clients[0]!.query.mock.calls.map(
      ([sql]) => sql as string,
    );
    expect(statements.some((sql) => sql.includes("CREATE TABLE"))).toBe(false);
    expect(statements).toContain("ROLLBACK");
  });
});
