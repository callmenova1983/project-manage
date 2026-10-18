// Isolated in-memory API for browser preview tests. No real workspace is touched.
import { buildApp } from "../../apps/api/src/app.ts";
import { createUser } from "../../apps/api/src/auth.ts";
import { randomUUID } from "node:crypto";
const origin = process.env.PM_FILE_TEST_ORIGIN;
const { app, repo } = await buildApp({
  databasePath: ":memory:",
  origin,
  production: process.env.PM_FILE_PREVIEW_PRODUCTION === "1",
});
repo.seed("preview-tests");
const password = randomUUID();
await createUser(repo, {
  workspaceId: "preview-tests",
  name: "File Tester",
  email: "preview@example.test",
  password,
});
const login = await app.inject({
  method: "POST",
  url: "/api/auth/login",
  headers: { origin },
  payload: { email: "preview@example.test", password },
});
const address = await app.listen({ port: 0, host: "127.0.0.1" });
console.log(
  JSON.stringify({ address, cookie: `pm_session=${login.cookies[0].value}` }),
);
process.on("SIGTERM", () => {
  void app.close().then(() => process.exit(0));
});
