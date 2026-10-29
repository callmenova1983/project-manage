import { testDatabaseConfig } from "../pg-helpers.js";
import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Repository } from "../../apps/api/src/database";
import { createUser } from "../../apps/api/src/auth";
it("bootstrap explicitly scopes an existing active account, grants access and revokes sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-admin-cli-")),
    path = join(dir, "db.sqlite"),
    repo = await Repository.open(testDatabaseConfig(path));
  try {
    await createUser(repo, {
      email: "operator-target@example.test",
      name: "Synthetic target",
      workspaceId: "selected",
      password: randomBytes(24).toString("hex"),
    });
    const user = (await repo.db.prepare("SELECT id FROM users").get())!;
    await repo.db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(
        "synthetic-token",
        String(user.id),
        "synthetic-csrf",
        Date.now() + 100000,
      );
    const env = {
      ...process.env,
      DB_SCHEMA: testDatabaseConfig(path).schema,
      CREDENTIAL_KEY_PATH: testDatabaseConfig(path).credentialKeyPath,
      PM_USER_EMAIL: "operator-target@example.test",
      PM_WORKSPACE_ID: "other",
    };
    expect(() =>
      execFileSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "apps/api/src/grant-admin.ts"],
        { env, stdio: "pipe" },
      ),
    ).toThrow();
    expect((await repo.db.prepare("SELECT role FROM users").get())!.role).toBe(
      "member",
    );
    const output = execFileSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "apps/api/src/grant-admin.ts"],
      {
        env: { ...env, PM_WORKSPACE_ID: "selected" },
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    expect(output).toContain("Administrator access granted");
    expect((await repo.db.prepare("SELECT role FROM users").get())!.role).toBe(
      "admin",
    );
    expect(
      (await repo.db.prepare("SELECT count(*) AS n FROM sessions").get())!.n,
    ).toBe(0);
    expect(
      (await repo.db.prepare("SELECT count(*) AS n FROM admin_audit").get())!.n,
    ).toBe(1);
  } finally {
    await repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
