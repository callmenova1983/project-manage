import { buildApp } from "../../apps/api/src/app.ts";
import { createUser } from "../../apps/api/src/auth.ts";
const origin = "http://127.0.0.1:4187";
const { app, repo } = await buildApp({
  databasePath: ":memory:",
  origin,
  wecomFetch: async (url) =>
    new Response(
      JSON.stringify(
        String(url).includes("gettoken")
          ? { access_token: "synthetic-token" }
          : String(url).includes("getuserinfo")
            ? { UserId: "member-1" }
            : String(url).includes("agent/get")
              ? { agentid: 1000001 }
              : { userid: "member-1", status: 1 },
      ),
    ),
});
repo.seed("wecom-test");
await createUser(repo, {
  workspaceId: "wecom-test",
  email: "wecom-admin@example.test",
  name: "企微测试管理员",
  password: "wecom-test-password-only",
});
repo.db
  .prepare(
    "UPDATE users SET role='admin' WHERE email='wecom-admin@example.test'",
  )
  .run();
await createUser(repo, {
  workspaceId: "wecom-test",
  email: "wecom-member@example.test",
  name: "企微测试成员",
  password: "wecom-test-password-only",
});
const user = repo.db
  .prepare("SELECT id FROM users WHERE email='wecom-member@example.test'")
  .get();
const directory = repo.directory("wecom-test");
directory.employees.push({
  id: "employee-1",
  employeeNo: "",
  name: "企微测试成员",
  departmentIds: [],
  position: "",
  email: "wecom-member@example.test",
  wecomUserId: "member-1",
  wecomCorpId: "corp-test",
  userId: user.id,
  active: true,
  source: "wecom",
});
repo.db
  .prepare("INSERT INTO workspace_directory VALUES(?,?)")
  .run("wecom-test", JSON.stringify(directory));
await app.listen({ port: 4187, host: "127.0.0.1" });
process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
