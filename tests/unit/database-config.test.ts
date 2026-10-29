import { describe, expect, it } from "vitest";
import { readDatabaseConfig } from "../../apps/api/src/database-config.js";

const settings = {
  DB_HOST: "db.example.test",
  DB_DATABASE: "project_test",
  DB_USERNAME: "test_user",
  DB_PASSWORD: "synthetic-test-password",
};

describe("PostgreSQL runtime configuration", () => {
  it("maps application variables without relying on local operating-system defaults", () => {
    expect(readDatabaseConfig(settings)).toMatchObject({
      type: "postgres",
      host: "db.example.test",
      database: "project_test",
      user: "test_user",
      password: settings.DB_PASSWORD,
      port: 5432,
      schema: "public",
      ssl: false,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
  });

  it("rejects SQLite and missing connection settings rather than silently creating a local database", () => {
    expect(() =>
      readDatabaseConfig({ ...settings, DB_TYPE: "sqlite" }),
    ).toThrow("DB_TYPE must be postgres");
    for (const name of Object.keys(settings)) {
      const env: NodeJS.ProcessEnv = { ...settings };
      delete env[name];
      expect(() => readDatabaseConfig(env)).toThrow(`${name} is required`);
    }
  });

  it("validates numeric settings and isolates application schemas", () => {
    for (const DB_PORT of ["", "0", "65536", "5432oops", "5.5", "-1"])
      expect(() => readDatabaseConfig({ ...settings, DB_PORT })).toThrow(
        "DB_PORT",
      );
    for (const DB_SCHEMA of [
      "",
      "public;drop schema public",
      "pg_catalog",
      "information_schema",
      "a".repeat(64),
    ])
      expect(() => readDatabaseConfig({ ...settings, DB_SCHEMA })).toThrow(
        "DB_SCHEMA",
      );
    expect(
      readDatabaseConfig({
        ...settings,
        DB_SCHEMA: "pm_test_123",
        DB_PORT: "15432",
      }),
    ).toMatchObject({
      schema: "pm_test_123",
      port: 15432,
    });
  });

  it("preserves passwords literally and requires certificate verification for SSL", () => {
    expect(
      readDatabaseConfig({ ...settings, DB_PASSWORD: " with spaces " })
        .password,
    ).toBe(" with spaces ");
    expect(readDatabaseConfig({ ...settings, DB_SSL: "true" }).ssl).toEqual({
      rejectUnauthorized: true,
    });
    expect(() => readDatabaseConfig({ ...settings, DB_SSL: "prefer" })).toThrow(
      "DB_SSL",
    );
    expect(() =>
      readDatabaseConfig({ ...settings, DB_SSL_CA_FILE: "/unused" }),
    ).toThrow("requires DB_SSL=true");
  });
});
