import type { PostgresDatabase } from "./postgres.js";
import {
  availableLoginName,
  suggestedLoginName,
} from "../../../packages/domain/login-name.js";
import { loginNameSchema } from "../../../packages/domain/login-name-schema.js";
export class LoginNameConflict extends Error {}
export async function assignLoginName(
  db: PostgresDatabase,
  name: string,
  requested?: string,
  exceptId = "",
) {
  const existing = await db
    .prepare("SELECT username FROM users WHERE username IS NOT NULL AND id<>?")
    .all(exceptId);
  const names = new Set(
    existing.map((row) => String(row.username).toLowerCase()),
  );
  const taken = (value: string) => names.has(value.toLowerCase());
  if (requested?.trim()) {
    const username = loginNameSchema.parse(requested);
    if (taken(username))
      throw new LoginNameConflict("This login name is already in use");
    return username;
  }
  return availableLoginName(suggestedLoginName(name), taken);
}
