import { randomUUID, createHash } from "node:crypto";
import { afterAll } from "vitest";
import { readDatabaseConfig } from "../apps/api/src/database-config.js";
import { PostgresDatabase } from "../apps/api/src/postgres.js";
const run = randomUUID();
const configs = new Map<string, ReturnType<typeof readDatabaseConfig>>();
export function testDatabaseConfig(path: string = randomUUID()) {
  let config = configs.get(path);
  if (!config) {
    config = {
      ...readDatabaseConfig(),
      schema: `pm_test_${createHash("sha256")
        .update(run + path)
        .digest("hex")
        .slice(0, 32)}`,
      credentialKeyPath: path + ".credentials-key",
    };
    configs.set(path, config);
  }
  return config;
}
afterAll(async () => {
  for (const config of configs.values()) {
    const db = new PostgresDatabase(config);
    try {
      await db.exec(`DROP SCHEMA IF EXISTS "${config.schema}" CASCADE`);
    } finally {
      await db.close();
    }
  }
});
