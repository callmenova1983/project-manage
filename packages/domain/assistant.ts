import { z } from "zod";

export const assistantSessionInput = z
  .object({
    version: z.number().int().nonnegative(),
    state: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AssistantSession = {
  version: number;
  updatedAt: string | null;
  state: Record<string, unknown>;
};
export type AssistantAnswer = {
  handled: boolean;
  text: string;
  links: { title: string; detail: string; path: string }[];
};
