import { z } from "zod";
import type { Task } from "./types.js";
export const taskFieldCopyInput = z
  .object({
    sourceId: z.string().min(1),
    sourceVersion: z.number().int().positive(),
    field: z.enum(["assignee", "dueDate"]),
    targets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    overwriteConfirmed: z.boolean(),
  })
  .strict();
export type TaskFieldCopyInput = z.infer<typeof taskFieldCopyInput>;
export class TaskFieldCopyConflict extends Error {}
export function planTaskFieldCopy(tasks: Task[], raw: TaskFieldCopyInput) {
  const input = taskFieldCopyInput.parse(raw);
  const source = tasks.find((task) => task.id === input.sourceId);
  if (!source || source.version !== input.sourceVersion)
    throw new TaskFieldCopyConflict(
      "Tasks changed. Close the copy dialog, refresh and try again.",
    );
  const value = source[input.field];
  if (!value || !value.trim())
    throw new Error("Fill in the source field before copying.");
  if (
    new Set(input.targets.map((target) => target.id)).size !==
      input.targets.length ||
    input.targets.some((target) => target.id === source.id)
  )
    throw new Error("Choose other tasks without duplicates.");
  const targets = input.targets.map((target) => {
    const task = tasks.find(
      (task) => task.id === target.id && task.projectId === source.projectId,
    );
    if (!task || task.version !== target.version)
      throw new TaskFieldCopyConflict(
        "Tasks changed. Close the copy dialog, refresh and try again.",
      );
    if (
      task[input.field] &&
      task[input.field] !== value &&
      !input.overwriteConfirmed
    )
      throw new Error("Confirm replacing the selected tasks' existing values.");
    return task;
  });
  const updatedAt = new Date().toISOString();
  return targets
    .filter((task) => task[input.field] !== value)
    .map((before) => ({
      before,
      after: {
        ...before,
        [input.field]: value,
        version: before.version + 1,
        updatedAt,
      } as Task,
    }));
}
