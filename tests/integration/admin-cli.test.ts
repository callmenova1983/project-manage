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
    repo = new Repository(path);
  try {
    await createUser(repo, {
      email: "operator-target@example.test",
      name: "Synthetic target",
      workspaceId: "selected",
      password: randomBytes(24).toString("hex"),
    });
    const user = repo.db.prepare("SELECT id FROM users").get()!;
    repo.db
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
      DATABASE_PATH: path,
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
    expect(repo.db.prepare("SELECT role FROM users").get()!.role).toBe(
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
    expect(repo.db.prepare("SELECT role FROM users").get()!.role).toBe("admin");
    expect(repo.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n).toBe(
      0,
    );
    expect(
      repo.db.prepare("SELECT count(*) AS n FROM admin_audit").get()!.n,
    ).toBe(1);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
