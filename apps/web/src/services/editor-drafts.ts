import { z } from "zod";
import {
  projectInput,
  taskInput,
  type Actor,
} from "../../../../packages/domain/types";
import { accountStorageKey } from "./account-storage";
export const EDITOR_DRAFT_TTL = 24 * 60 * 60 * 1000;
export const projectDraftFields = projectInput.extend({
  name: z.string().max(120),
  client: z.string().max(120),
  owner: z.string().max(80),
});
export const projectEditorDraft = z
  .object({ fields: projectDraftFields, aliases: z.string().max(2000) })
  .strict();
export const taskEditorDraft = taskInput.extend({
  title: z.string().max(240),
  assignee: z.string().max(80),
  dueDate: z.string().max(10).nullable(),
});
export const notesEditorDraft = z.string().max(20000);
const envelope = z
  .object({
    version: z.literal(1),
    savedAt: z.number().finite(),
    baseVersion: z.number().int().positive().nullable(),
    attempted: z.boolean(),
    value: z.unknown(),
  })
  .strict();
export type EditorDraft<T> = {
  version: 1;
  savedAt: number;
  baseVersion: number | null;
  attempted: boolean;
  value: T;
};
type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export function editorDraftPrefix(
  mode: "server" | "local",
  actor: Pick<Actor, "id" | "workspaceId">,
) {
  return accountStorageKey("editor-drafts", mode, actor) + ":";
}
export function editorDraftKey(
  prefix: string,
  kind: "project" | "task" | "notes",
  projectId: string,
  entityId: string,
  parentId = "",
) {
  return prefix + JSON.stringify([kind, projectId, entityId, parentId]);
}
export type EditorDraftRead<T> =
  | { kind: "none" | "invalid" | "expired" | "unavailable" }
  | { kind: "ready"; draft: EditorDraft<T> };
export function readEditorDraft<T>(
  key: string,
  schema: z.ZodType<T>,
  now = Date.now(),
  storage?: StorageLike,
): EditorDraftRead<T> {
  try {
    const target = storage ?? sessionStorage,
      raw = target.getItem(key);
    if (!raw) return { kind: "none" };
    if (raw.length > 100000) return { kind: "invalid" };
    try {
      const parsed = envelope.parse(JSON.parse(raw)),
        value = schema.parse(parsed.value);
      if (parsed.savedAt > now + 60000) return { kind: "invalid" };
      if (now - parsed.savedAt > EDITOR_DRAFT_TTL) {
        target.removeItem(key);
        return { kind: "expired" };
      }
      return { kind: "ready", draft: { ...parsed, value } };
    } catch {
      return { kind: "invalid" };
    }
  } catch {
    return { kind: "unavailable" };
  }
}
export function writeEditorDraft<T>(
  key: string,
  schema: z.ZodType<T>,
  draft: EditorDraft<T>,
  storage?: StorageLike,
) {
  try {
    const raw = JSON.stringify({
      ...envelope.parse(draft),
      value: schema.parse(draft.value),
    });
    if (raw.length > 100000) return false;
    (storage ?? sessionStorage).setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
export function clearEditorDraft(key: string, storage?: StorageLike) {
  try {
    (storage ?? sessionStorage).removeItem(key);
    return true;
  } catch {
    return false;
  }
}
export function clearAccountEditorDrafts(
  prefix: string,
  storage?: StorageLike,
) {
  try {
    const target = storage ?? sessionStorage,
      keys: string[] = [];
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
