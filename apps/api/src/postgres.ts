import { timedQuery } from "./performance.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg, {
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export type DatabaseRow = QueryResultRow;
export type PostgresConfig = PoolConfig & { schema?: string };

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Rewrite anonymous parameters, never the contents of SQL literals/comments.
 * For the standalone PostgreSQL JSON existence operator use ??, or query() with
 * native $1 parameters. ?| and ?& are recognized as operators without escaping.
 */
export function postgresPlaceholders(sql: string): string {
  const identifierCharacter = /[\p{L}\p{N}_$]/u;
  let result = "",
    parameter = 0,
    nativeParameters = false;
  for (let i = 0; i < sql.length;) {
    const start = i,
      current = sql[i]!;
    if (current === "'" || current === '"') {
      const escaped =
        current === "'" &&
        /[eE]/.test(sql[i - 1] ?? "") &&
        !identifierCharacter.test(sql[i - 2] ?? "");
      i++;
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i++] !== current) continue;
        if (sql[i] === current) {
          i++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) throw new Error("Unterminated SQL quoted value");
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment");
    } else if (current === "$" && !identifierCharacter.test(sql[i - 1] ?? "")) {
      const tag = sql.slice(i).match(/^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new Error("Unterminated SQL dollar quote");
        i = end + tag.length;
      } else {
        if (/^\$[1-9]\d*/.test(sql.slice(i))) nativeParameters = true;
        i++;
      }
    } else if (current === "?") {
      if (sql[i - 1] === "@") {
        i++;
        result += "?";
        continue;
      }
      if (sql[i + 1] === "?") {
        result += "?";
        i += 2;
        continue;
      }
      if (sql[i + 1] === "|" || sql[i + 1] === "&") i += 2;
      else {
        result += `$${++parameter}`;
        i++;
        continue;
      }
    } else i++;
    result += sql.slice(start, i);
  }
  if (parameter && nativeParameters)
    throw new Error("Do not mix anonymous and numbered SQL parameters");
  return result;
}

/** Preserve millisecond timestamps/counts as numbers, without truncating BIGINTs. */
export function parsePostgresInteger(value: string): number | string {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

type TransactionContext = { client: PoolClient; active: boolean };

export class PostgresDatabase {
  readonly schema: string;
  private readonly pool: pg.Pool;
  private readonly context = new AsyncLocalStorage<TransactionContext>();
  private initializing?: Promise<void>;
  private readonly configuredClients = new WeakSet<PoolClient>();
  private readonly listenerConfig: pg.ClientConfig;

  constructor(config: PostgresConfig) {
    this.schema = config.schema ?? "public";
    if (
      !/^[A-Za-z_][A-Za-z_0-9]{0,62}$/.test(this.schema) ||
      /^pg_/i.test(this.schema) ||
      this.schema === "information_schema"
    )
      throw new Error("Invalid application database schema");
    const connection = { ...config };
    delete connection.schema;
    this.listenerConfig = connection;
    this.pool = new pg.Pool({
      max: 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ...connection,
      types: {
        getTypeParser: (oid, format) =>
          oid === 20 && format !== "binary"
            ? parsePostgresInteger
            : pg.types.getTypeParser(oid, format),
      },
    });
    // Idle connections can fail independently of a request. Consume that event;
    // request-bound failures still reject the request normally.
    this.pool.on("error", () =>
      console.error("An idle PostgreSQL connection failed"),
    );
  }

  private async connect(): Promise<PoolClient> {
    const client = await this.pool.connect();
    try {
      if (!this.configuredClients.has(client)) {
        await client.query("SELECT set_config('search_path', $1, false)", [
          `${quoteIdentifier(this.schema)}, pg_catalog`,
        ]);
        this.configuredClients.add(client);
      }
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  }

  async query<Row extends QueryResultRow = DatabaseRow>(
    sql: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    const transaction = this.context.getStore();
    if (transaction) {
      if (!transaction.active)
        throw new Error("Database transaction has ended");
      return timedQuery(() => transaction.client.query<Row>(sql, values));
    }
    const client = await this.connect();
    try {
      return await timedQuery(() => client.query<Row>(sql, values));
    } finally {
      client.release();
    }
  }

  /** LISTEN owns a dedicated connection; it never occupies a query-pool slot. */
  async listen(callback: (payload: string) => void, disconnected: () => void) {
    const client = new pg.Client(this.listenerConfig);
    client.on("error", disconnected);
    client.on("end", disconnected);
    client.on("notification", (message) => {
      if (message.payload) callback(message.payload);
    });
    try {
      await client.connect();
      await client.query("LISTEN pm_workspace_sync");
    } catch (error) {
      await client.end().catch(() => {});
      throw error;
    }
    return () => client.end();
  }

  prepare(sql: string) {
    const statement = postgresPlaceholders(sql);
    return {
      get: async (...values: unknown[]): Promise<DatabaseRow | undefined> =>
        (await this.query(statement, values)).rows[0],
      all: async (...values: unknown[]): Promise<DatabaseRow[]> =>
        (await this.query(statement, values)).rows,
      run: async (...values: unknown[]): Promise<{ changes: number }> => ({
        changes: (await this.query(statement, values)).rowCount ?? 0,
      }),
    };
  }

  async exec(sql: string): Promise<void> {
    await this.query(sql);
  }

  async readSnapshot<T>(callback: () => T | Promise<T>): Promise<T> {
    if (this.context.getStore()?.active) return callback();
    return this.transaction(callback, true);
  }

  async transaction<T>(
    callback: () => T | Promise<T>,
    readOnly = false,
  ): Promise<T> {
    if (this.context.getStore())
      throw new Error("Nested database transactions are not supported");
    const client = await this.connect();
    const context: TransactionContext = { client, active: true };
    let discard = false;
    try {
      await client.query(
        readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
      );
      // Preserve the original global write ordering, including activity cursors,
      // quota reservations and idempotency, across all application instances.
      if (!readOnly)
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`project-manage:${this.schema}`],
        );
      const result = await this.context.run(context, callback);
      context.active = false;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      context.active = false;
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  initialize(): Promise<void> {
    this.initializing ??= this.migrate().catch((error: unknown) => {
      this.initializing = undefined;
      throw error;
    });
    return this.initializing;
  }

  private async migrate(): Promise<void> {
    const folder = resolve("apps/api/migrations-postgres");
    const files = readdirSync(folder)
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    if (!files.length) throw new Error("PostgreSQL migrations are missing");
    const migrations = files.map((file) => {
      const sql = readFileSync(resolve(folder, file), "utf8");
      return {
        version: Number(file.split("_")[0]),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
    await this.transaction(async () => {
      const relations = (
        await this.query<{ name: string }>(
          "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S','f')",
          [this.schema],
        )
      ).rows;
      const known = relations.some(
        (relation) => relation.name === "pm_schema_migrations",
      );
      if (relations.length && !known)
        throw new Error(
          "Database schema is not empty and is not initialized for this application",
        );
      await this.exec(
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(this.schema)}`,
      );
      if (!known)
        await this.exec(
          "CREATE TABLE pm_schema_migrations (version BIGINT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
        );
      const applied = (
        await this.query<{ version: number; checksum: string }>(
          "SELECT version, checksum FROM pm_schema_migrations ORDER BY version",
        )
      ).rows;
      for (const existing of applied) {
        const current = migrations.find(
          (migration) => migration.version === Number(existing.version),
        );
        if (!current || current.checksum !== existing.checksum)
          throw new Error(
            "PostgreSQL migration history does not match this application version",
          );
      }
      for (const migration of migrations) {
        if (
          applied.some(
            (existing) => Number(existing.version) === migration.version,
          )
        )
          continue;
        await this.exec(migration.sql);
        await this.query(
          "INSERT INTO pm_schema_migrations(version,checksum,applied_at) VALUES($1,$2,$3)",
          [migration.version, migration.checksum, new Date().toISOString()],
        );
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
