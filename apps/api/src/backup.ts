import { spawn } from "node:child_process";
import { getCACertificates } from "node:tls";
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  linkSync,
  rmSync,
  existsSync,
  realpathSync,
  copyFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";
import type { DatabaseConfig } from "./database-config.js";
import { PostgresDatabase } from "./postgres.js";

function isInside(root: string, target: string) {
  const child = relative(root, target);
  return (
    !child ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

function runClient(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    // No shell, credentials in environment only, and no raw database errors in
    // the application output. Errors may contain connection strings or data.
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () =>
      reject(
        new Error(`Cannot run ${command}. Install PostgreSQL client tools.`),
      ),
    );
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} failed. Check database access and use client tools at least as new as the server.`,
          ),
        );
    });
  });
}

/** Consistent PostgreSQL custom archive plus the separate private credential key.
 * Archive readability is checked; restoration must still be rehearsed separately.
 */
export async function backupDatabase(
  config: DatabaseConfig,
  destination: string,
) {
  const output = resolve(destination);
  const keyOutput = `${output}.credentials-key`;
  if (existsSync(output) || existsSync(keyOutput))
    throw new Error("Backup destination already exists");
  const publicRoot = existsSync("dist/web")
    ? realpathSync("dist/web")
    : resolve("dist/web");
  if (isInside(publicRoot, output))
    throw new Error("Backups cannot be stored in the public web directory");
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  if (isInside(publicRoot, realpathSync(dirname(output))))
    throw new Error("Backups cannot be stored in the public web directory");
  const temp = mkdtempSync(join(dirname(output), ".pm-backup-"));
  chmodSync(temp, 0o700);
  const snapshot = join(temp, "snapshot.dump");
  const keySnapshot = join(temp, "credentials.key");
  let publishedKey = false;
  try {
    const db = new PostgresDatabase(config);
    try {
      // Verify this is an application database without running migrations.
      const encrypted = await db.query(
        "SELECT 1 FROM workspace_ai_credentials UNION ALL SELECT 1 FROM workspace_wecom_credentials UNION ALL SELECT 1 FROM notification_wecom_config UNION ALL SELECT 1 FROM wecom_login_config LIMIT 1",
      );
      if (encrypted.rows.length && !existsSync(config.credentialKeyPath))
        throw new Error(
          "The credential encryption key is missing; a complete backup cannot be created",
        );
    } finally {
      await db.close();
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: config.host,
      PGPORT: String(config.port),
      PGDATABASE: config.database,
      PGUSER: config.user,
      PGPASSWORD: config.password,
      PGCONNECT_TIMEOUT: String(
        Math.max(1, Math.ceil(config.connectionTimeoutMillis / 1000)),
      ),
      PGSSLMODE: config.ssl ? "verify-full" : "disable",
    };
    // Remove settings that could select a different connection/schema than the
    // validated application configuration.
    delete env.PGSERVICE;
    delete env.PGSERVICEFILE;
    delete env.PGOPTIONS;
    delete env.PGSSLROOTCERT;
    delete env.PGSSLCERT;
    delete env.PGSSLKEY;
    if (config.ssl) {
      env.PGSSLROOTCERT = join(temp, "root.crt");
      writeFileSync(
        env.PGSSLROOTCERT,
        (typeof config.ssl === "object" && config.ssl.ca) ||
          getCACertificates("default").join("\n"),
        { mode: 0o600 },
      );
    }
    await runClient(
      "pg_dump",
      [
        "--no-password",
        "--format=custom",
        `--file=${snapshot}`,
        `--schema=${config.schema}`,
        "--strict-names",
      ],
      env,
    );
    if (!statSync(snapshot).size) throw new Error("Database backup is empty");
    chmodSync(snapshot, 0o600);
    await runClient("pg_restore", ["--list", snapshot], env);
    if (existsSync(config.credentialKeyPath)) {
      if (statSync(config.credentialKeyPath).size !== 32)
        throw new Error("Invalid credential encryption key");
      copyFileSync(config.credentialKeyPath, keySnapshot);
      chmodSync(keySnapshot, 0o600);
      linkSync(keySnapshot, keyOutput);
      publishedKey = true;
    }
    // Publish without replacing a prior backup, including a concurrent writer.
    linkSync(snapshot, output);
    return {
      path: output,
      format: "postgres-custom" as const,
      verification: "archive-readable" as const,
      ...(publishedKey ? { credentialKeyPath: keyOutput } : {}),
    };
  } catch (error) {
    if (publishedKey) rmSync(keyOutput);
    throw error;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
