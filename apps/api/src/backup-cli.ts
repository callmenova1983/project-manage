import "dotenv/config";
import { backupDatabase } from "./backup.js";
import { readDatabaseConfig } from "./database-config.js";
const destination =
  process.argv[2] ??
  `data/backups/project-manage-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
try {
  const result = await backupDatabase(readDatabaseConfig(), destination);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Backup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
