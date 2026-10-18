import { Temporal } from "@js-temporal/polyfill";
import { calendarWeek } from "./time-zone.js";
import { dateSchema, type Task } from "./types.js";
export type TaskWorkPlan = Pick<Task, "workWeek" | "workDates">;

function check(plan: TaskWorkPlan) {
  if (
    plan.workWeek &&
    calendarWeek(dateSchema.parse(plan.workWeek)) !== plan.workWeek
  )
    throw new Error("Choose a Monday week start");
  if (
    plan.workDates.some(
      (date) => calendarWeek(dateSchema.parse(date)) !== plan.workWeek,
    )
  )
    throw new Error("Work dates must belong to the selected work week.");
}
/** Preserve each selected weekday when moving the whole explicitly planned week. */
export function moveTaskWorkWeek(
  plan: TaskWorkPlan,
  date: string | null,
): TaskWorkPlan {
  check(plan);
  if (!date) return { workWeek: null, workDates: [] };
  const workWeek = calendarWeek(dateSchema.parse(date));
  const monday = Temporal.PlainDate.from(workWeek);
  return {
    workWeek,
    workDates: [
      ...new Set(
        plan.workDates.map((old) =>
          monday
            .add({ days: Temporal.PlainDate.from(old).dayOfWeek - 1 })
            .toString(),
        ),
      ),
    ].sort(),
  };
}
export function setTaskWorkDay(
  plan: TaskWorkPlan,
  date: string,
  selected: boolean,
): TaskWorkPlan {
  check(plan);
  dateSchema.parse(date);
  const targetWeek = calendarWeek(date);
  const next =
    selected && targetWeek !== plan.workWeek
      ? moveTaskWorkWeek(plan, targetWeek)
      : { workWeek: plan.workWeek, workDates: [...plan.workDates] };
  next.workDates = selected
    ? [...new Set([...next.workDates, date])].sort()
    : next.workDates.filter((day) => day !== date);
  return next;
}
