import { z } from "zod";

// Unassigned sources belong to the workspace until a project is chosen.
export const CAPTURE_SCOPE = "__capture__";
export const recognitionDepthSchema = z.enum(["text", "ocr", "deep"]);
export type CaptureRecognitionDepth = z.infer<typeof recognitionDepthSchema>;
export function assembleCaptureText(
  text: string,
  materials: { name?: string; text: string }[],
) {
  return [
    text.trim(),
    ...materials
      .filter((material) => material.text.trim())
      .map((material) =>
        [material.name ? `【${material.name}】` : "", material.text.trim()]
          .filter(Boolean)
          .join("\n"),
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
}
export const captureSourceSchema = z
  .object({
    text: z.string().max(20000),
    materialIds: z.array(z.string().uuid()).max(6),
    recognitionDepth: recognitionDepthSchema.optional(),
  })
  .strict();
export type CaptureSource = z.infer<typeof captureSourceSchema>;
export const captureAnalysisInput = captureSourceSchema
  .extend({
    externalProcessingConfirmed: z.literal(true),
  })
  .refine(
    (v) => !!v.text.trim() || v.materialIds.length > 0,
    "Paste text or add a file first",
  );
export const captureAnalysisOutput = z
  .object({
    text: z.string().trim().min(1).max(20000),
    uncertainties: z.array(z.string().max(300)).max(12),
  })
  .strict();
export type CaptureAnalysis = z.infer<typeof captureAnalysisOutput> & {
  model: string;
};
