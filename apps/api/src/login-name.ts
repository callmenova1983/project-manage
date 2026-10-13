import type { DatabaseSync } from "node:sqlite";
import {
  availableLoginName,
  suggestedLoginName,
} from "../../../packages/domain/login-name.js";
import { loginNameSchema } from "../../../packages/domain/login-name-schema.js";
export class LoginNameConflict extends Error {}
export function assignLoginName(
  db: DatabaseSync,
  name: string,
  requested?: string,
  exceptId = "",
) {
  const taken = (value: string) =>
    !!db
      .prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id<>?")
      .get(value, exceptId);
  if (requested?.trim()) {
    const username = loginNameSchema.parse(requested);
    if (taken(username))
      throw new LoginNameConflict("This login name is already in use");
    return username;
  }
  return availableLoginName(suggestedLoginName(name), taken);
}
