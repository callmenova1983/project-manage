import { z } from "zod";
export const MATERIAL_LIMIT = 8 * 1024 * 1024;
export const materialKinds = ["image", "excel", "word", "text"] as const;
export const materialInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    data: z
      .string()
      .min(4)
      .max(Math.ceil(MATERIAL_LIMIT / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const progressSourceSchema = z
  .object({
    text: z.string().max(12000),
    materialIds: z.array(z.string().uuid()).max(6),
    model: z.string().max(100).optional(),
    recognizedText: z.string().max(16000).optional(),
    uncertainties: z.array(z.string().max(300)).max(12).optional(),
  })
  .strict();
export type ProgressSource = z.infer<typeof progressSourceSchema>;
export interface ProgressMaterial {
  id: string;
  name: string;
  kind: (typeof materialKinds)[number];
  size: number;
  text: string;
  imageCount: number;
  warnings: string[];
}
export const progressAnalysisInput = z
  .object({
    text: z.string().max(12000),
    materialIds: z.array(z.string().uuid()).max(6),
    version: z.number().int().positive(),
    externalProcessingConfirmed: z.literal(true),
  })
  .strict()
  .refine(
    (v) => !!v.text.trim() || v.materialIds.length > 0,
    "Paste text or add a file first",
  );
export type ProgressAnalysisInput = z.infer<typeof progressAnalysisInput>;
export const progressAnalysisOutput = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    recognizedText: z.string().max(16000),
    uncertainties: z.array(z.string().max(300)).max(12),
  })
  .strict();
export type ProgressAnalysis = z.infer<typeof progressAnalysisOutput> & {
  model: string;
};
export const materialMetadataSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(160),
    kind: z.enum(materialKinds),
    size: z.number().int().positive().max(MATERIAL_LIMIT),
    text: z.string().max(16000),
    imageCount: z.number().int().min(0).max(6),
    warnings: z.array(z.string().max(300)).max(12),
  })
  .strict();
export const progressFileArchive = z
  .object({
    projectId: z.string().min(1).max(100),
    metadata: materialMetadataSchema,
    data: materialInput.shape.data,
    images: z
      .array(
        z
          .string()
          .max(12 * 1024 * 1024)
          .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
      )
      .max(6),
  })
  .strict();
export const progressEntryArchive = z
  .object({
    id: z.string().min(1).max(160),
    projectId: z.string().min(1).max(100),
    text: z.string().min(1).max(4000),
    author: z.string().max(80).nullable(),
    reportedAt: z.string().datetime().nullable(),
    recordedAt: z.string().datetime().nullable(),
    correction: z.boolean(),
    originalSource: progressSourceSchema.optional(),
  })
  .strict();
export const progressArchiveInput = z.object({
  progressFiles: z.array(progressFileArchive).max(1000).optional(),
  progressArchive: z.array(progressEntryArchive).max(5000).optional(),
});
