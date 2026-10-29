import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DatabaseConfig {
  type: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl: false | { rejectUnauthorized: true; ca?: string };
  max: number;
  connectionTimeoutMillis: number;
  credentialKeyPath: string;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number,
) {
  const raw = env[name] ?? String(fallback);
  const value = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return value;
}

/** Runtime connections are PostgreSQL only. Never fall back to a local database. */
export function readDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const type = env.DB_TYPE ?? "postgres";
  if (type !== "postgres")
    throw new Error(
      "DB_TYPE must be postgres; SQLite is supported only as a migration source",
    );
  const required = (name: string, preserveWhitespace = false) => {
    const value = env[name];
    if (value === undefined || !value.trim())
      throw new Error(`${name} is required`);
    return preserveWhitespace ? value : value.trim();
  };
  const schema = env.DB_SCHEMA ?? "public";
  if (
    !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
    schema.startsWith("pg_") ||
    schema === "information_schema"
  )
    throw new Error(
      "DB_SCHEMA must be a lowercase application schema identifier (1–63 characters)",
    );
  const ssl = env.DB_SSL ?? "false";
  if (ssl !== "true" && ssl !== "false")
    throw new Error("DB_SSL must be true or false");
  if (env.DB_SSL_CA_FILE && ssl !== "true")
    throw new Error("DB_SSL_CA_FILE requires DB_SSL=true");
  return {
    type,
    host: required("DB_HOST"),
    port: integer(env, "DB_PORT", 5432, 65535),
    database: required("DB_DATABASE"),
    user: required("DB_USERNAME"),
    password: required("DB_PASSWORD", true),
    schema,
    ssl:
      ssl === "true"
        ? {
            rejectUnauthorized: true,
            ...(env.DB_SSL_CA_FILE
              ? { ca: readFileSync(resolve(env.DB_SSL_CA_FILE), "utf8") }
              : {}),
          }
        : false,
    max: integer(env, "DB_POOL_MAX", 10, 100),
    connectionTimeoutMillis: integer(
      env,
      "DB_CONNECT_TIMEOUT_MS",
      5000,
      120000,
    ),
    credentialKeyPath: resolve(
      env.CREDENTIAL_KEY_PATH || "./data/credentials.key",
    ),
  };
}
