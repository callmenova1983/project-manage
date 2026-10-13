import { z } from "zod";
import {
  intakeFields,
  normalizeName,
  type IntakeField,
} from "../../../../packages/domain/intake";
export const mappingTemplateSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(60),
    hasHeader: z.boolean(),
    columns: z
      .array(
        z
          .object({ header: z.string().max(200), field: z.enum(intakeFields) })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type MappingTemplate = z.infer<typeof mappingTemplateSchema>;
const schema = z
  .object({
    version: z.literal(1),
    templates: z.array(mappingTemplateSchema).max(20),
  })
  .strict();
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function readMappingTemplates(
  key: string,
  storage?: StorageLike,
): { templates: MappingTemplate[]; unavailable: boolean } {
  try {
    const raw = (storage ?? localStorage).getItem(key);
    if (!raw) return { templates: [], unavailable: false };
    if (raw.length > 200000) throw new Error();
    return { ...schema.parse(JSON.parse(raw)), unavailable: false };
  } catch {
    return { templates: [], unavailable: true };
  }
}
export function saveMappingTemplates(
  key: string,
  templates: MappingTemplate[],
  storage?: StorageLike,
) {
  try {
    (storage ?? localStorage).setItem(
      key,
      JSON.stringify(schema.parse({ version: 1, templates })),
    );
    return true;
  } catch {
    return false;
  }
}
/** Explicit reuse only. Never guess a reordered duplicate/blank header's position. */
export function reuseMapping(
  template: MappingTemplate,
  headers: string[],
): IntakeField[] {
  const saved = template.columns.map((c) => normalizeName(c.header));
  const current = headers.map(normalizeName);
  if (!template.hasHeader) {
    if (headers.length !== template.columns.length)
      throw new Error("This template needs the same number of columns.");
    return template.columns.map((c) => c.field);
  }
  return current.map((header, index) => {
    if (
      !header ||
      current.indexOf(header) !== index ||
      current.lastIndexOf(header) !== index ||
      saved.filter((h) => h === header).length !== 1
    )
      return "ignore";
    return template.columns[saved.indexOf(header)]?.field ?? "ignore";
  });
}
