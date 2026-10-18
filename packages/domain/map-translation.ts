import { z } from "zod";

export const hasHan = (text: string) => /\p{Script=Han}/u.test(text);
export const mapTranslationInput = z
  .object({
    texts: z.array(z.string().trim().min(1).max(4000)).min(1).max(40),
    externalProcessingConfirmed: z.literal(true),
  })
  .strict()
  .refine(
    (value) => value.texts.join("\n").length <= 12000,
    "Translation batch is too large",
  );

export interface MapTranslation {
  translations: string[];
}
