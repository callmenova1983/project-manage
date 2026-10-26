import "dotenv/config";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Repository } from "./database.js";
const email = z.string().email().parse(process.env.PM_USER_EMAIL).toLowerCase();
const workspace = z.string().min(1).parse(process.env.PM_WORKSPACE_ID);
const repo = new Repository(
  process.env.DATABASE_PATH ?? "./data/project-manage.sqlite",
);
try {
  repo.transaction(() => {
    const row = repo.db
      .prepare(
        "SELECT id,role FROM users WHERE email=? AND workspace_id=? AND status='active' AND requires_activation=0",
      )
      .get(email, workspace);
    if (!row)
      throw new Error(
        "An active account in the explicitly selected workspace is required",
      );
    if (row.role === "admin")
      throw new Error("This account already has administrator access");
    repo.db
      .prepare("UPDATE users SET role='admin',version=version+1 WHERE id=?")
      .run(String(row.id));
    repo.db.prepare("DELETE FROM sessions WHERE user_id=?").run(String(row.id));
    const at = new Date().toISOString(),
      id = randomUUID();
    repo.db
      .prepare(
        "INSERT INTO admin_audit(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
      )
      .run(
        id,
        workspace,
        at,
        JSON.stringify({
          id,
          createdAt: at,
          actor: "Server operator",
          action: "Granted administrator access through CLI",
          target: String(row.id),
        }),
      );
  });
  console.log(
    "Administrator access granted. Existing sessions were revoked; sign in again.",
  );
} finally {
  repo.close();
}
