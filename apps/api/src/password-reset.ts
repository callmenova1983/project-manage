import type { DatabaseSync } from "node:sqlite";
import { passwordHash } from "./auth.js";

export class PasswordResetError extends Error {}
export interface ResetAccount {
  id: string;
  email: string;
  // Optimistic guard only. Never print this value or request the old password.
  previousHash: string;
}
export function findResetAccount(
  db: DatabaseSync,
  email: string,
): ResetAccount {
  const row = db
    .prepare("SELECT id,email,password_hash FROM users WHERE email=?")
    .get(email.toLowerCase());
  if (!row)
    throw new PasswordResetError(
      "Account not found in this database. No account was created.",
    );
  return {
    id: String(row.id),
    email: String(row.email),
    previousHash: String(row.password_hash),
  };
}
export function validateNewPassword(password: string): void {
  if (password.length < 14 || password.length > 500)
    throw new PasswordResetError(
      "Use a password or passphrase of 14–500 characters.",
    );
}
export async function resetAccountPassword(
  db: DatabaseSync,
  account: ResetAccount,
  password: string,
): Promise<number> {
  validateNewPassword(password);
  const hash = await passwordHash(password);
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db
      .prepare(
        "UPDATE users SET password_hash=? WHERE id=? AND email=? AND password_hash=?",
      )
      .run(hash, account.id, account.email, account.previousHash);
    if (Number(changed.changes) !== 1)
      throw new PasswordResetError(
        "The account changed while you were entering the password. Cancelled; run the command again.",
      );
    const revoked = db
      .prepare("DELETE FROM sessions WHERE user_id=?")
      .run(account.id);
    db.exec("COMMIT");
    return Number(revoked.changes);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
