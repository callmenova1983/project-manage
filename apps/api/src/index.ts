import "dotenv/config";
import { buildApp } from "./app.js";
const production = process.env.NODE_ENV === "production";
const origin = process.env.APP_ORIGIN ?? "http://localhost:4173";
if (production && !origin.startsWith("https://"))
  throw new Error("Production requires an explicit HTTPS APP_ORIGIN");
const { app } = await buildApp({
  databasePath: process.env.DATABASE_PATH ?? "./data/project-manage.sqlite",
  origin,
  production,
});
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
});
console.log(
  `Project Manage API listening on ${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001}`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
