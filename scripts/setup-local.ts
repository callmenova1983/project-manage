import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { Repository } from "../apps/api/src/database.js";
import { createUser } from "../apps/api/src/auth.js";
mkdirSync("data", { recursive: true });
const repo = new Repository("./data/project-manage.sqlite");
try {
  if (repo.db.prepare("SELECT 1 FROM users LIMIT 1").get())
    console.log(
      "Already configured. Credentials are in data/local-login.txt if created by this command.",
    );
  else {
    const password = randomBytes(18).toString("base64url");
    repo.seed("demo");
    await createUser(repo, {
      email: "demo@example.test",
      name: "Alex Morgan",
      password,
      workspaceId: "demo",
    });
    writeFileSync(
      "data/local-login.txt",
      `Email: demo@example.test\nPassword: ${password}\n`,
      { mode: 0o600 },
    );
    if (!existsSync(".env"))
      writeFileSync(
        ".env",
        "HOST=127.0.0.1\nPORT=3001\nDATABASE_PATH=./data/project-manage.sqlite\nAPP_ORIGIN=http://localhost:4173\n",
        { mode: 0o600 },
      );
    console.log(
      "Local workspace ready. Open data/local-login.txt for your generated credentials.",
    );
  }
} finally {
  repo.close();
}
