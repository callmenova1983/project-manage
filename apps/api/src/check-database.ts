import "dotenv/config";
import { pathToFileURL } from "node:url";
import { readDatabaseConfig, type DatabaseConfig } from "./database-config.js";
import { PostgresDatabase } from "./postgres.js";

/** Read-only connectivity/identity check. Does not initialize tables or run migrations. */
export async function checkDatabase(config: DatabaseConfig) {
  const db = new PostgresDatabase(config);
  try {
    const identity = (
      await db.query<{ database: string; version: string }>(
        "SELECT current_database() AS database, current_setting('server_version') AS version",
      )
    ).rows[0]!;
    const tables = (
      await db.query<{ count: string | number }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",
        [config.schema],
      )
    ).rows[0]!;
    return {
      connected: true,
      ...identity,
      schema: config.schema,
      tables: Number(tables.count),
    };
  } finally {
    await db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(await checkDatabase(readDatabaseConfig()), null, 2),
    );
  } catch (error) {
    console.error(`Database check failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
