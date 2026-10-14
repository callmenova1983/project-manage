import "dotenv/config";
import { backupDatabase } from "./backup.js";
const destination =
  process.argv[2] ??
  `data/backups/project-manage-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
try {
  const result = await backupDatabase(
    process.env.DATABASE_PATH ?? "data/project-manage.sqlite",
    destination,
  );
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Backup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
