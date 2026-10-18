import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Repository } from "./database.js";

/** Keep the existing private key and backup location shared by workspace credentials. */
export function workspaceCredentialKey(
  repo: Repository,
  databasePath: string,
  memoryKey: Buffer,
): Buffer {
  if (databasePath === ":memory:") return memoryKey;
  const path = resolve(databasePath) + ".credentials-key";
  if (!existsSync(path)) {
    if (
      repo.db
        .prepare(
          "SELECT 1 FROM workspace_ai_credentials UNION ALL SELECT 1 FROM workspace_wecom_credentials UNION ALL SELECT 1 FROM notification_wecom_config LIMIT 1",
        )
        .get()
    )
      throw new Error("The credential encryption key is missing");
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
  }
  chmodSync(path, 0o600);
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("Invalid credential encryption key");
  return key;
}
