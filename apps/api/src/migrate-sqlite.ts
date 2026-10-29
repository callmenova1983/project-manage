import "dotenv/config";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { PostgresDatabase, quoteIdentifier } from "./postgres.js";

type Row = Record<string, unknown>;
type Table = {
  name: string;
  columns: { name: string; type: string }[];
  dependencies: string[];
  count: number;
};
const q = quoteIdentifier;
const credentialsTables = [
  "workspace_ai_credentials",
  "workspace_wecom_credentials",
  "notification_wecom_config",
  "wecom_login_config",
];

function sourceTables(db: DatabaseSync): Table[] {
  const names = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));
  if (!names.includes("workspaces") || !names.includes("migrations"))
    throw new Error("Source is not a Project Manage database");
  const pending = names.map((name): Table => ({
    name,
    columns: db
      .prepare(`PRAGMA table_info(${q(name)})`)
      .all()
      .map((row) => ({ name: String(row.name), type: String(row.type) })),
    dependencies: db
      .prepare(`PRAGMA foreign_key_list(${q(name)})`)
      .all()
      .map((row) => String(row.table))
      .filter((table) => table !== name),
    count: Number(db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get()!.n),
  }));
  const ordered: Table[] = [];
  while (pending.length) {
    const index = pending.findIndex((table) =>
      table.dependencies.every((dependency) =>
        ordered.some((done) => done.name === dependency),
      ),
    );
    if (index < 0)
      throw new Error(
        "Source has unsupported cyclic or missing table dependencies",
      );
    ordered.push(pending.splice(index, 1)[0]!);
  }
  return ordered;
}

function checkSource(db: DatabaseSync) {
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
    throw new Error("SQLite source integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("SQLite source foreign key check failed");
}

function dataVersion(db: DatabaseSync) {
  return Number(db.prepare("PRAGMA data_version").get()!.data_version);
}

async function targetTables(db: PostgresDatabase) {
  return (
    await db.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
      [db.schema],
    )
  ).rows
    .map((row) => row.name)
    .filter((name) => name !== "pm_schema_migrations");
}

async function checkEmptyTarget(db: PostgresDatabase) {
  const tables = await targetTables(db);
  for (const table of tables) {
    if (
      (await db.query(`SELECT 1 FROM ${q(db.schema)}.${q(table)} LIMIT 1`)).rows
        .length
    )
      throw new Error(
        `Target table ${table} is not empty; migration never overwrites existing data`,
      );
  }
  return tables;
}

async function checkColumns(db: PostgresDatabase, table: Table) {
  const columns = (
    await db.query<{ name: string }>(
      "SELECT column_name AS name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
      [db.schema, table.name],
    )
  ).rows
    .map((row) => row.name)
    .sort();
  const expected = [
    "rowid",
    ...table.columns.map((column) => column.name),
  ].sort();
  if (JSON.stringify(columns) !== JSON.stringify(expected))
    throw new Error(
      `Source/target columns differ for ${table.name}; upgrade the source before migrating`,
    );
}

/** An earlier branch recorded migration 022 before adding its session binding
 * table. No historical bindings exist in that source, so only this exact table
 * may remain newly empty in PostgreSQL. All other differences still fail. */
function compatibleTableSets(source: Table[], target: string[]) {
  const sourceNames = new Set(source.map((table) => table.name));
  const targetNames = new Set(target);
  const unknownSource = source.filter((table) => !targetNames.has(table.name));
  const newEmptyTables = target
    .filter((table) => !sourceNames.has(table))
    .sort();
  if (
    unknownSource.length ||
    newEmptyTables.some((table) => table !== "wecom_login_sessions")
  )
    throw new Error(
      "Source/target table sets differ; no business data was imported",
    );
  return newEmptyTables;
}

function credentialKey(
  sourcePath: string,
  targetPath: string,
  tables: Table[],
) {
  const sourceKey = `${sourcePath}.credentials-key`;
  const encrypted = tables.some(
    (table) => credentialsTables.includes(table.name) && table.count > 0,
  );
  if (!existsSync(sourceKey)) {
    if (encrypted)
      throw new Error(
        "Source credential encryption key is missing; encrypted settings cannot be migrated safely",
      );
    return null;
  }
  const key = readFileSync(sourceKey);
  if (key.length !== 32)
    throw new Error("Source credential encryption key is invalid");
  if (existsSync(targetPath) && !readFileSync(targetPath).equals(key))
    throw new Error(
      "Target credential encryption key differs; refusing to replace it",
    );
  return key;
}

function publishKey(path: string, key: Buffer) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    if (!readFileSync(path).equals(key))
      throw new Error(
        "Target credential encryption key changed during migration",
      );
    chmodSync(path, 0o600);
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, key, { flag: "wx", mode: 0o600 });
  try {
    linkSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function normalized(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array)
    return ["blob", Buffer.from(value).toString("base64")];
  if (/INT|REAL|NUMERIC|DECIMAL|DOUBLE|FLOAT/i.test(type))
    return ["numeric", String(value)];
  return ["text", String(value)];
}

function hashRow(
  hash: ReturnType<typeof createHash>,
  row: Row,
  columns: { name: string; type: string }[],
) {
  hash.update(
    JSON.stringify(
      columns.map((column) => normalized(row[column.name], column.type)),
    ),
  );
  hash.update("\n");
}

async function copyTable(
  source: DatabaseSync,
  db: PostgresDatabase,
  table: Table,
) {
  const columns = [{ name: "rowid", type: "INTEGER" }, ...table.columns];
  const names = columns.map((column) => q(column.name)).join(",");
  const sourceStatement = source.prepare(
    `SELECT rowid AS rowid,${table.columns.map((column) => q(column.name)).join(",")} FROM ${q(table.name)} ORDER BY rowid`,
  );
  sourceStatement.setReadBigInts(true);
  const sourceHash = createHash("sha256");
  let copied = 0;
  let batch: Row[] = [];
  const insert = async () => {
    if (!batch.length) return;
    const values: unknown[] = [];
    const tuples = batch
      .map(
        (row) =>
          `(${columns
            .map((column) => {
              const value = row[column.name];
              values.push(
                value instanceof Uint8Array
                  ? Buffer.from(value)
                  : typeof value === "bigint"
                    ? value.toString()
                    : value,
              );
              return `$${values.length}`;
            })
            .join(",")})`,
      )
      .join(",");
    await db.query(
      `INSERT INTO ${q(db.schema)}.${q(table.name)} (${names}) VALUES ${tuples}`,
      values,
    );
    batch = [];
  };
  for (const row of sourceStatement.iterate()) {
    hashRow(sourceHash, row, columns);
    batch.push(row);
    copied++;
    if (batch.length === 200) await insert();
  }
  await insert();
  const targetHash = createHash("sha256");
  let verified = 0;
  let after: unknown = null;
  for (;;) {
    const rows: Row[] = (
      await db.query(
        `SELECT ${names} FROM ${q(db.schema)}.${q(table.name)} ${after === null ? "" : "WHERE rowid > $1"} ORDER BY rowid LIMIT 200`,
        after === null ? [] : [after],
      )
    ).rows;
    if (!rows.length) break;
    for (const row of rows) hashRow(targetHash, row, columns);
    verified += rows.length;
    after = rows[rows.length - 1]!.rowid;
  }
  if (
    copied !== table.count ||
    copied !== verified ||
    sourceHash.digest("hex") !== targetHash.digest("hex")
  )
    throw new Error(`Full-content verification failed for ${table.name}`);
  const sequence = (
    await db.query<{ sequence: string }>(
      "SELECT pg_get_serial_sequence($1, 'rowid') AS sequence",
      [`${q(db.schema)}.${q(table.name)}`],
    )
  ).rows[0]?.sequence;
  if (!sequence)
    throw new Error(`Missing insertion sequence for ${table.name}`);
  const maximum = after === null ? 0n : BigInt(String(after));
  await db.query("SELECT setval($1::regclass,$2::bigint,$3::boolean)", [
    sequence,
    maximum > 0n ? maximum.toString() : "1",
    maximum > 0n,
  ]);
  return { table: table.name, rows: copied, verified: true };
}

/** SQLite is supported here only as a read-only, one-time import source. */
export async function migrateSqlite(options: {
  source: string;
  config: DatabaseConfig;
  apply?: boolean;
  backupDirectory?: string;
}) {
  const sourcePath = resolve(options.source);
  if (!existsSync(sourcePath))
    throw new Error("SQLite migration source does not exist");
  const original = new DatabaseSync(sourcePath, { readOnly: true });
  const db = new PostgresDatabase(options.config);
  let snapshot: DatabaseSync | undefined;
  try {
    checkSource(original);
    const initialVersion = dataVersion(original);
    const tables = sourceTables(original);
    const key = credentialKey(
      sourcePath,
      options.config.credentialKeyPath,
      tables,
    );
    const existing = await checkEmptyTarget(db);
    if (!options.apply) {
      return {
        mode: "dry-run",
        source: sourcePath,
        target: {
          database: options.config.database,
          schema: options.config.schema,
        },
        schemaInitializationRequired: !existing.length,
        newEmptyTables: existing.length
          ? compatibleTableSets(tables, existing)
          : [],
        tables: tables.map(({ name, count }) => ({ table: name, rows: count })),
        credentialKey: key ? "ready" : "not-required",
        message:
          "No data written. Stop all SQLite writers, then rerun with --apply.",
      };
    }
    const backupDirectory = resolve(
      options.backupDirectory ?? "./data/backups",
    );
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = resolve(
      backupDirectory,
      `before-postgres-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sqlite`,
    );
    // Reserve a private path before SQLite writes any contents.
    writeFileSync(backupPath, "", { flag: "wx", mode: 0o600 });
    await backup(original, backupPath);
    chmodSync(backupPath, 0o600);
    if (key) publishKey(`${backupPath}.credentials-key`, key);
    snapshot = new DatabaseSync(backupPath, { readOnly: true });
    checkSource(snapshot);
    const snapshotTables = sourceTables(snapshot);
    if (dataVersion(original) !== initialVersion)
      throw new Error(
        "SQLite changed during preparation; stop its writers and retry",
      );
    await db.initialize();
    const { results, newEmptyTables } = await db.transaction(async () => {
      const target = await checkEmptyTarget(db);
      const newEmptyTables = compatibleTableSets(snapshotTables, target);
      for (const table of snapshotTables) await checkColumns(db, table);
      const verified = [];
      for (const table of snapshotTables)
        verified.push(await copyTable(snapshot!, db, table));
      if (dataVersion(original) !== initialVersion)
        throw new Error(
          "SQLite changed during migration; transaction cancelled. Stop its writers and retry",
        );
      // Publish the existing key before committing encrypted records. Never overwrite another key.
      if (key) publishKey(options.config.credentialKeyPath, key);
      return { results: verified, newEmptyTables };
    });
    return {
      mode: "applied",
      backup: backupPath,
      target: {
        database: options.config.database,
        schema: options.config.schema,
      },
      tables: results,
      newEmptyTables,
      totalRows: results.reduce((sum, table) => sum + table.rows, 0),
      credentialKey: key ? "preserved" : "not-required",
    };
  } finally {
    snapshot?.close();
    original.close();
    await db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    const sourceFlag = args.indexOf("--source");
    const backupFlag = args.indexOf("--backup-directory");
    const known = new Set(["--apply", "--source", "--backup-directory"]);
    for (let index = 0; index < args.length; index++) {
      const flag = args[index]!;
      if (!known.has(flag))
        throw new Error(
          "Use --source <sqlite-file> [--apply] [--backup-directory <private-directory>]",
        );
      if (
        flag !== "--apply" &&
        (!args[++index] || args[index]!.startsWith("--"))
      )
        throw new Error(`${flag} requires a value`);
    }
    if (sourceFlag < 0)
      throw new Error("Explicit --source <sqlite-file> is required");
    const result = await migrateSqlite({
      source: args[sourceFlag + 1]!,
      config: readDatabaseConfig(),
      apply: args.includes("--apply"),
      ...(backupFlag >= 0 ? { backupDirectory: args[backupFlag + 1]! } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Migration failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
