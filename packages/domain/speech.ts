import { z } from "zod";
export const DEFAULT_SPEECH_MODEL = "qwen3-asr-flash";
export const MAX_SPEECH_SECONDS = 120;
export const speechInput = z
  .object({
    requestId: z.string().uuid(),
    data: z
      .string()
      .min(60)
      .max(6 * 1024 * 1024),
    mime: z.literal("audio/wav"),
  })
  .strict();
export type SpeechInput = z.infer<typeof speechInput>;
export interface SpeechCapabilities {
  enabled: boolean;
  model: string;
  maxSeconds: number;
  reason: string | null;
}
export interface SpeechTranscript {
  requestId: string;
  text: string;
  model: string;
  seconds: number | null;
}
