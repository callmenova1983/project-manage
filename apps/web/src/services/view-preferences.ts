import { z } from "zod";
export const viewPreferencesSchema = z
  .object({
    version: z.literal(1),
    taskLayout: z.enum(["list", "board", "calendar", "gantt"]),
    projectTaskLayout: z.enum(["list", "board", "calendar", "gantt"]),
    projectLayout: z.enum(["list", "board", "cards"]),
    taskGroup: z.enum(["none", "project", "assignee", "status"]),
    taskSort: z.enum(["manual", "due", "updated", "title"]),
    density: z.enum(["comfortable", "compact"]),
    taskColumns: z
      .array(z.enum(["status", "project", "assignee", "work", "dueDate"]))
      .max(5)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();
export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;
export function defaultViewPreferences(): ViewPreferences {
  return {
    version: 1,
    taskLayout: "list",
    projectTaskLayout: "list",
    projectLayout: "list",
    taskGroup: "none",
    taskSort: "manual",
    density: "comfortable",
    taskColumns: ["status", "project", "assignee", "work", "dueDate"],
  };
}
const maxLength = 16000;
const failure = "View preferences could not be saved in this browser.";
const invalid =
  "Saved view preferences are invalid or use a newer version. Defaults are shown.";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function readViewPreferences(
  storage: StorageLike,
  key: string,
): { value: ViewPreferences; error: string } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { value: defaultViewPreferences(), error: "" };
    if (raw.length > maxLength) throw new Error(invalid);
    return { value: viewPreferencesSchema.parse(JSON.parse(raw)), error: "" };
  } catch {
    return { value: defaultViewPreferences(), error: invalid };
  }
}
export function writeViewPreferences(
  storage: StorageLike,
  key: string,
  value: ViewPreferences,
): string {
  try {
    const previous = storage.getItem(key);
    // A newer client's format must remain intact when this older client loads it.
    if (previous) {
      try {
        const parsed: unknown = JSON.parse(previous);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "version" in parsed &&
          typeof parsed.version === "number" &&
          parsed.version > 1
        )
          return invalid;
      } catch {
        /* Explicit saving can repair corrupt JSON. */
      }
    }
    const raw = JSON.stringify(viewPreferencesSchema.parse(value));
    if (raw.length > maxLength) return failure;
    storage.setItem(key, raw);
    return "";
  } catch {
    return failure;
  }
}
