import "dotenv/config";
// Real, isolated API for AI-access browser tests. No persistent user data is touched.
import { buildApp } from "../../apps/api/src/app.ts";
import { createUser } from "../../apps/api/src/auth.ts";
import { randomUUID } from "node:crypto";

const origin = process.env.PM_AI_ACCESS_TEST_ORIGIN;
const { app, repo } = await buildApp({ isolatedDatabase: true, origin });
if (!/^pm_test_[a-f0-9]{32}$/.test(repo.db.schema))
  throw new Error("Refusing test writes outside an isolated PostgreSQL schema");

await repo.seed("ai-access-preview");
const password = randomUUID();
await createUser(repo, {
  workspaceId: "ai-access-preview",
  name: "AI Access Tester",
  email: "ai-access@example.test",
  password,
});
const login = await app.inject({
  method: "POST",
  url: "/api/auth/login",
  headers: { origin },
  payload: { email: "ai-access@example.test", password },
});
const address = await app.listen({ port: 0, host: "127.0.0.1" });
console.log(
  JSON.stringify({ address, cookie: `pm_session=${login.cookies[0].value}` }),
);
process.on("SIGTERM", () => {
  void app.close().then(() => process.exit(0));
});
