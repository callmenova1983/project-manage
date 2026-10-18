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
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type ReferenceClassification = z.infer<
  typeof referenceClassificationSchema
> & { provider: "qwen" | "rules"; model: string | null };
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
export function classifyReferenceName(
  name: string,
): (typeof referenceCategories)[number] {
  if (
    /执行凭证|任务执行|施工记录|验收照片|完成照片|调试照片|task.evidence|execution/i.test(
      name,
    )
  )
    return "task-evidence";
  if (/现场|踏勘|勘察|site.photo|site.visit/i.test(name)) return "site-photo";
  if (/报价|询价|价格|清单|预算|quotation|pricing|quote|cost/i.test(name))
    return "quote";
  if (/方案|建议书|设计|proposal|solution|design/i.test(name))
    return "proposal";
  if (/合同|协议|contract|agreement/i.test(name)) return "contract";
  if (/图纸|施工图|平面图|drawing|\.dwg$/i.test(name)) return "drawing";
  if (/报告|纪要|总结|report|minutes/i.test(name)) return "report";
  return "other";
}

/** Decide each attachment separately; one meeting screenshot must not turn a quote into tasks. */
export function inferAttachmentPurpose(
  name: string,
  note: string,
  pastedImage = false,
): "reference" | "extract" | "unknown" {
  const records =
    /会议截图|会议记录|会议纪要|聊天记录|聊天截图|工作记录|工作日报|工作总结|minutes|chat.?log/i;
  if (records.test(name)) return "extract";
  if (classifyReferenceName(name) !== "other") return "reference";
  if (pastedImage && /\.(png|jpe?g|webp)$/i.test(name)) return "extract";
  if (records.test(note) || /识别|提取|整理成|转成事项/.test(note))
    return "extract";
  if (
    classifyReferenceName(note) !== "other" ||
    /归档|保存资料|存入资料/.test(note)
  )
    return "reference";
  if (/\.(txt|csv|tsv)$/i.test(name)) return "extract";
  return "unknown";
}
