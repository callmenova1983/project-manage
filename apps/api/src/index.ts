import "dotenv/config";
import { buildApp } from "./app.js";
import { readQwenConfig } from "./ai/config.js";
import { readWecomConfig } from "./wecom.js";
import { configuredAppOrigin, configuredCodespacesRewrite } from "./origin.js";
const production = process.env.NODE_ENV === "production";
const origin = configuredAppOrigin(process.env);
const codespacesOriginRewrite = configuredCodespacesRewrite(
  process.env,
  origin,
);
const { app } = await buildApp({
  databasePath: process.env.DATABASE_PATH ?? "./data/project-manage.sqlite",
  origin,
  production,
  qwen: readQwenConfig(process.env),
  wecom: readWecomConfig(process.env),
  starterPassword: process.env.PM_DEFAULT_USER_PASSWORD,
  originDiagnostics: process.env.ORIGIN_DIAGNOSTICS === "1",
  codespacesOriginRewrite,
});
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
});
console.log(
  `Project Manage API listening on ${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001}`,
);
console.log(`Allowed browser origin: ${origin}`);
if (codespacesOriginRewrite)
  console.log(
    "Codespaces Origin rewrite compatibility enabled for the configured port only.",
  );
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
