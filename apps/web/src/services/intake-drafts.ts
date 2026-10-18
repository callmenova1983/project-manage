import { z } from "zod";
import {
  intakeFields,
  intakeSourceSchema,
} from "../../../../packages/domain/intake";
import {
  projectInput,
  taskInput,
  type Actor,
} from "../../../../packages/domain/types";

export const DRAFT_TTL = 24 * 60 * 60 * 1000;
export const DRAFT_MAX_LENGTH = 2_000_000;
// Drafts accept incomplete edits and preserve whitespace. Submission continues
// to use the domain validators; restoring a draft never grants confirmation.
const candidate = z.object({
  id: z.string().max(100),
  sourceRow: z.number().int().min(1).max(1000),
  sourcePart: z.number().int().min(0).max(199).optional(),
  contextRows: z.array(z.number().int().min(1).max(1000)).max(20).optional(),
  matchEvidence: z
    .array(
      z.object({
        projectId: z.string().max(100),
        kind: z.enum(["name", "alias", "partial", "mention"]),
        value: z.string().max(20000),
      }),
    )
    .max(1000)
    .optional(),
  matchConfirmed: z
    .boolean()
    .optional()
    .transform(() => false),
  sourceText: z.string().max(200000),
  requestedChannel: z.string().max(120).optional(),
  selected: z.boolean(),
  project: projectInput.extend({
    name: z.string().max(120),
    client: z.string().max(120),
    owner: z.string().max(80),
    channelId: z.string().max(50).optional(),
    stage: z.string().max(50),
  }),
  task: taskInput
    .omit({ projectId: true })
    .extend({
      title: z.string().max(240),
      assignee: z.string().max(80),
    })
    .nullable(),
  matches: z.array(z.string().max(100)).max(1000),
  targetProjectId: z.string().max(100),
  targetProjectVersion: z.number().int().positive().nullable(),
  duplicateConfirmed: z.boolean().transform(() => false),
  warnings: z.array(z.string().max(2000)).max(30),
});
export const intakeDraftSchema = z.object({
  version: z.literal(1),
  savedAt: z.number().finite(),
  step: z.enum(["source", "review"]),
  source: intakeSourceSchema,
  fromFile: z.boolean(),
  mapping: z.array(z.enum(intakeFields)).max(30),
  hasHeader: z.boolean(),
  candidates: z.array(candidate).max(200),
});
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function intakeDraftKey(
  mode: "server" | "local",
  actor: Pick<Actor, "workspaceId" | "id">,
) {
  return (
    "project-manage-intake-draft-v1:" +
    JSON.stringify([mode, actor.workspaceId, actor.id])
  );
}
export type DraftRead =
  | { kind: "none" | "expired" | "invalid" | "unavailable" }
  | { kind: "ready"; draft: IntakeDraft };
export function readIntakeDraft(
  key: string,
  now = Date.now(),
  storage?: DraftStorage,
): DraftRead {
  try {
    const target = storage ?? window.sessionStorage;
    const raw = target.getItem(key);
    if (!raw) return { kind: "none" };
    if (raw.length > DRAFT_MAX_LENGTH) return { kind: "invalid" };
    let draft: IntakeDraft;
    try {
      draft = intakeDraftSchema.parse(JSON.parse(raw));
    } catch {
      return { kind: "invalid" };
    }
    if (draft.savedAt > now + 60000) return { kind: "invalid" };
    if (now - draft.savedAt > DRAFT_TTL) {
      target.removeItem(key);
      return { kind: "expired" };
    }
    return { kind: "ready", draft };
  } catch {
    return { kind: "unavailable" };
  }
}
export function writeIntakeDraft(
  key: string,
  draft: IntakeDraft,
  storage?: DraftStorage,
): boolean {
  try {
    const raw = JSON.stringify(intakeDraftSchema.parse(draft));
    if (raw.length > DRAFT_MAX_LENGTH) return false;
    (storage ?? window.sessionStorage).setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
export function clearIntakeDraft(key: string, storage?: DraftStorage): boolean {
  try {
    (storage ?? window.sessionStorage).removeItem(key);
    return true;
  } catch {
    return false;
  }
}
