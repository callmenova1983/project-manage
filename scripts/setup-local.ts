import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { Repository } from "../apps/api/src/database.js";
import { readDatabaseConfig } from "../apps/api/src/database-config.js";
import { createUser } from "../apps/api/src/auth.js";

// Explicit bootstrap for an empty, configured development PostgreSQL database.
// Existing databases, including those imported from SQLite, are never seeded.
if (process.env.NODE_ENV === "production")
  throw new Error(
    "setup:local is for development only. Use user:create for production accounts.",
  );
const repo = await Repository.open(readDatabaseConfig());
try {
  if (await repo.db.prepare("SELECT 1 FROM users LIMIT 1").get())
    console.log(
      "Already configured. Credentials are in data/local-login.txt if created by this command.",
    );
  else {
    if (await repo.db.prepare("SELECT 1 FROM workspaces LIMIT 1").get())
      throw new Error(
        "The database contains a workspace. Use user:create; no demo data was added.",
      );
    if (existsSync("data/local-login.txt"))
      throw new Error(
        "data/local-login.txt already exists. Preserve those credentials and use user:create for this empty database.",
      );
    const password = randomBytes(18).toString("base64url");
    await repo.transaction(async () => {
      if (await repo.db.prepare("SELECT 1 FROM workspaces LIMIT 1").get())
        throw new Error("The database changed. No demo data was added.");
      await repo.seed("demo");
      await createUser(repo, {
        email: "demo@example.test",
        name: "Alex Morgan",
        password,
        workspaceId: "demo",
      });
    });
    mkdirSync("data", { recursive: true, mode: 0o700 });
    writeFileSync(
      "data/local-login.txt",
      `Email: demo@example.test\nPassword: ${password}\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Local workspace ready. Open data/local-login.txt for your generated credentials.",
    );
  }
} finally {
  await repo.close();
}
