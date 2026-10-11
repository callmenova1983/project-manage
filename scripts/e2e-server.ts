import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { buildApp } from "../apps/api/src/app.js";
import { createUser } from "../apps/api/src/auth.js";
mkdirSync("data", { recursive: true });
for (const suffix of ["", "-wal", "-shm"])
  rmSync(`data/e2e.sqlite${suffix}`, { force: true });
const { app, repo } = await buildApp({
  databasePath: "data/e2e.sqlite",
  origin: "http://127.0.0.1:4173",
});
repo.seed("e2e");
const password = randomBytes(24).toString("hex");
await createUser(repo, {
  email: "e2e@example.test",
  name: "Test Member",
  password,
  workspaceId: "e2e",
});
writeFileSync(
  "data/e2e-login.json",
  JSON.stringify({ email: "e2e@example.test", password }),
  { mode: 0o600 },
);
const adminPassword = randomBytes(24).toString("hex");
await createUser(repo, {
  email: "e2e-admin@example.test",
  name: "Test Administrator",
  password: adminPassword,
  workspaceId: "e2e",
});
repo.db
  .prepare("UPDATE users SET role='admin' WHERE email='e2e-admin@example.test'")
  .run();
writeFileSync(
  "data/e2e-admin-login.json",
  JSON.stringify({ email: "e2e-admin@example.test", password: adminPassword }),
  { mode: 0o600 },
);
await app.listen({ host: "127.0.0.1", port: 3001 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
