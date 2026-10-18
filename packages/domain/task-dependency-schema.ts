import { z } from "zod";
export const taskDependencyInput = z
  .object({
    taskId: z.string().min(1).max(100),
    type: z.literal("finish_to_start"),
  })
  .strict();
export const taskDependenciesInput = z.array(taskDependencyInput).max(100);
export const taskDependencyReplaceInput = z
  .object({
    version: z.number().int().positive(),
    dependencies: taskDependenciesInput,
  })
  .strict();
export type TaskDependency = z.infer<typeof taskDependencyInput>;
export type TaskDependencyReplace = z.infer<typeof taskDependencyReplaceInput>;
