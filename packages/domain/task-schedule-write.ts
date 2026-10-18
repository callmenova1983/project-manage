import { z } from "zod";
import { dateSchema, DomainError, type Task } from "./types.js";
import { taskScheduleFields, validateTaskSchedule } from "./task-schedule.js";
const fields = {
  scheduleStart: dateSchema.nullable().optional(),
  scheduleEnd: dateSchema.nullable().optional(),
  milestone: z.boolean().optional(),
};
const hasPatch = (value: {
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  milestone?: boolean;
}) => taskScheduleFields.some((field) => value[field] !== undefined);
export const taskSchedulePatchInput = z
  .object({ version: z.number().int().positive(), ...fields })
  .strict()
  .refine(hasPatch, "Choose a schedule field to change.");
export const taskScheduleChangeInput = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().positive(),
    ...fields,
  })
  .strict()
  .refine(hasPatch, "Choose a schedule field to change.");
export const taskScheduleBatchInput = z
  .object({
    revision: z.number().int().positive(),
    changes: z
      .array(taskScheduleChangeInput)
      .min(1)
      .max(100)
      .refine(
        (values) =>
          new Set(values.map((value) => value.id)).size === values.length,
        "Choose each task once.",
      ),
  })
  .strict();
export type TaskSchedulePatch = z.infer<typeof taskSchedulePatchInput>;
export type TaskScheduleBatch = z.infer<typeof taskScheduleBatchInput>;
export type TaskScheduleChange = z.infer<typeof taskScheduleChangeInput>;
export class TaskScheduleConflict extends Error {
  constructor(
    message: string,
    public current?: Task,
  ) {
    super(message);
  }
}
export function planTaskSchedules(
  tasks: readonly Task[],
  changes: readonly TaskScheduleChange[],
  now = new Date(),
) {
  const input = z.array(taskScheduleChangeInput).min(1).max(100).parse(changes);
  if (new Set(input.map((change) => change.id)).size !== input.length)
    throw new DomainError("Choose each task once.");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  const result: { before: Task; after: Task }[] = [];
  for (const change of input) {
    const before = byId.get(change.id);
    if (!before) throw new DomainError("Task unavailable in this workspace.");
    if (before.version !== change.version)
      throw new TaskScheduleConflict(
        "Task schedule changed. Reload the latest version.",
        before,
      );
    if (before.voided)
      throw new DomainError(
        "Restore a voided task before changing its schedule.",
      );
    const patch = Object.fromEntries(
      taskScheduleFields
        .filter((field) => change[field] !== undefined)
        .map((field) => [field, change[field]]),
    );
    const candidate = { ...before, ...patch };
    validateTaskSchedule(candidate);
    if (
      parents.has(before.id) &&
      (candidate.scheduleStart || candidate.scheduleEnd || candidate.milestone)
    )
      throw new DomainError(
        "Parent tasks use aggregate schedules. Clear their independent schedule before adding subtasks.",
      );
    if (
      taskScheduleFields.every(
        (field) =>
          (before[field] ?? (field === "milestone" ? false : null)) ===
          (candidate[field] ?? (field === "milestone" ? false : null)),
      )
    )
      continue;
    result.push({
      before,
      after: {
        ...candidate,
        version: before.version + 1,
        updatedAt: now.toISOString(),
      },
    });
  }
  return result;
}
