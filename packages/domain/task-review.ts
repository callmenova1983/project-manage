import { z } from "zod";
import { dateSchema } from "./types.js";

export const reviewField = z.enum([
  "assignee",
  "estimatedDate",
  "dueDate",
  "reminderAt",
]);
export const reviewChoice = z
  .object({
    label: z.string().trim().min(1).max(80),
    field: reviewField,
    value: z.string().trim().min(1).max(80),
  })
  .strict()
  .superRefine((choice, ctx) => {
    const valid =
      choice.field === "assignee" ||
      (choice.field === "reminderAt"
        ? z.string().datetime({ offset: true }).safeParse(choice.value).success
        : dateSchema.safeParse(choice.value).success);
    if (!valid)
      ctx.addIssue({ code: "custom", message: "Invalid suggested time" });
  });
export const taskReviewOutput = z
  .object({
    questions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(240),
            quote: z.string().trim().min(1).max(240),
            choices: z.array(reviewChoice).max(4),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type ReviewChoice = z.infer<typeof reviewChoice>;
export type TaskReviewOutput = z.infer<typeof taskReviewOutput>;
export type TaskReview = TaskReviewOutput & { taskId: string; version: number };
