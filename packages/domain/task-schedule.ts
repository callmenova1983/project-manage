import { DomainError, dateSchema, type TaskInput } from "./types.js";
export const taskScheduleFields = [
  "scheduleStart",
  "scheduleEnd",
  "milestone",
] as const;
/** Preserve omitted fields from old forms; explicit null and false remain explicit. */
export function retainTaskSchedule<T extends TaskInput>(
  input: T,
  previous?: TaskInput,
): T {
  const next = { ...input };
  for (const field of [...taskScheduleFields, "dependencies"] as const) {
    if (input[field] === undefined && previous?.[field] !== undefined)
      Object.assign(next, { [field]: previous[field] });
  }
  return next;
}
export function validateTaskSchedule(
  task: Pick<TaskInput, "scheduleStart" | "scheduleEnd" | "milestone">,
) {
  const start = task.scheduleStart ?? null,
    end = task.scheduleEnd ?? null;
  if (!!start !== !!end)
    throw new DomainError("Schedule start and end must be set together.");
  if (start && end) {
    dateSchema.parse(start);
    dateSchema.parse(end);
    if (start > end)
      throw new DomainError("Schedule start cannot follow schedule end.");
  }
  if (task.milestone && (!start || start !== end))
    throw new DomainError("A milestone requires the same start and end date.");
}
