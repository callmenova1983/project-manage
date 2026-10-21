import { z } from "zod";
export const referenceCategories = [
  "quote",
  "proposal",
  "contract",
  "drawing",
  "report",
  "site-photo",
  "task-evidence",
  "other",
] as const;
export const referenceCategorySchema = z.enum(referenceCategories);
export const referenceLabels: Record<
  (typeof referenceCategories)[number],
  string
> = {
  quote: "报价",
  proposal: "方案",
  contract: "合同",
  drawing: "图纸",
  report: "报告 / 纪要",
  "site-photo": "现场照片",
  "task-evidence": "任务执行凭证",
  other: "其他资料 / 待确认",
};
export const referenceClassifyInput = z
  .object({
    materialIds: z.array(z.string().uuid()).min(1).max(6),
    notes: z.string().max(2000),
    externalProcessingConfirmed: z.literal(true),
  })
  .strict();
export const referenceClassificationSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            category: referenceCategorySchema,
            projectId: z.string().nullable(),
            purpose: z.enum(["reference", "extract", "unknown"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type ReferenceClassification = z.infer<
  typeof referenceClassificationSchema
> & { provider: "qwen"; model: string | null };
export const referenceArchiveInput = z
  .object({
    projectId: z.string().min(1),
    version: z.number().int().positive(),
    files: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            category: referenceCategorySchema,
            taskId: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()
  .refine(
    (v) => new Set(v.files.map((f) => f.id)).size === v.files.length,
    "附件不能重复归档。",
  );
export type ReferenceArchiveInput = z.infer<typeof referenceArchiveInput>;
