import { assignLoginName } from "./login-name.js";
import {
  scrypt,
  randomBytes,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import type { Repository } from "./database.js";
import { HttpError } from "./database.js";
import type { Actor } from "../../../packages/domain/types.js";
const derive = promisify(scrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const key = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function createUser(
  repo: Repository,
  input: {
    email: string;
    name: string;
    password: string;
    workspaceId: string;
    username?: string;
  },
) {
  if (input.password.length < 14)
    throw new Error("Password must contain at least 14 characters");
  repo.workspace(input.workspaceId);
  const hash = await passwordHash(input.password);
  repo.db
    .prepare(
      "INSERT INTO users(id,workspace_id,email,name,password_hash,username) VALUES(?,?,?,?,?,?)",
    )
    .run(
      randomUUID(),
      input.workspaceId,
      input.email.toLowerCase(),
      input.name,
      hash,
      assignLoginName(repo.db, input.name, input.username),
    );
}
export function sessionActor(
  repo: Repository,
  token: string | undefined,
): { actor: Actor; csrf: string } {
  if (!token) throw new HttpError(401, "Sign in to continue");
  const row = repo.db
    .prepare(
      "SELECT users.id,users.workspace_id,users.email,users.name,users.role,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND users.status='active' AND users.requires_activation=0",
    )
    .get(hashToken(token), Date.now());
  if (!row) throw new HttpError(401, "Your session expired. Sign in again.");
  return {
    actor: {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      email: String(row.email),
      role: row.role as "member" | "admin",
    },
    csrf: String(row.csrf),
  };
}
