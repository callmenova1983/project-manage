import { z } from "zod";
import { referenceCategorySchema } from "./capture-reference.js";
import { recognitionDepthSchema } from "./capture.js";
export const MATERIAL_LIMIT = 8 * 1024 * 1024;
export const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;
export const WORKSPACE_IMPORT_LIMIT = 128 * 1024 * 1024;
const fileData = (limit: number) =>
  z
    .string()
    .min(4)
    .max(Math.ceil(limit / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const projectFileData = fileData(PROJECT_FILE_LIMIT);
export const materialKinds = [
  "image",
  "excel",
  "word",
  "text",
  "file",
] as const;
export const materialInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    data: fileData(MATERIAL_LIMIT),
  })
  .strict();
export const progressSourceSchema = z
  .object({
    text: z.string().max(12000),
    workDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const date = new Date(value);
        return (
          !Number.isNaN(date.getTime()) &&
          date.toISOString().slice(0, 10) === value
        );
      })
      .optional(),
    materialIds: z.array(z.string().uuid()).max(6),
    recognitionDepth: recognitionDepthSchema.optional(),
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
  createdAt?: string;
  uploadedBy?: string;
  referenceOnly?: boolean;
  category?: z.infer<typeof referenceCategorySchema>;
  taskId?: string;
  uploadedById?: string;
}
export const progressAnalysisInput = z
  .object({
    text: z.string().max(12000),
    materialIds: z.array(z.string().uuid()).max(6),
    recognitionDepth: recognitionDepthSchema.default("text"),
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
    size: z.number().int().positive().max(PROJECT_FILE_LIMIT),
    text: z.string().max(16000),
    imageCount: z.number().int().min(0).max(6),
    warnings: z.array(z.string().max(300)).max(12),
    createdAt: z.string().datetime().optional(),
    uploadedBy: z.string().max(80).optional(),
    referenceOnly: z.boolean().optional(),
    category: referenceCategorySchema.optional(),
    taskId: z.string().min(1).max(100).optional(),
    uploadedById: z.string().min(1).max(100).optional(),
  })
  .strict();
export const progressFileArchive = z
  .object({
    projectId: z.string().min(1).max(100),
    metadata: materialMetadataSchema,
    data: projectFileData,
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
