import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export function validTimeZone(value: string) {
  if (!/^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(value)) return false;
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}
export const timeZoneInput = z
  .string()
  .max(80)
  .refine(validTimeZone, "Choose a valid IANA time zone");
export const workspaceSettingsInput = z
  .object({ version: z.number().int().positive(), timeZone: timeZoneInput })
  .strict();
export type WorkspaceSettings = z.infer<typeof workspaceSettingsInput>;
export const defaultWorkspaceSettings: WorkspaceSettings = {
  version: 1,
  timeZone: "UTC",
};
export function zonedDay(date = new Date(), timeZone = "UTC") {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
export function calendarWeek(date: string) {
  const day = Temporal.PlainDate.from(date);
  return day.subtract({ days: day.dayOfWeek - 1 }).toString();
}
export function zonedWeek(date = new Date(), timeZone = "UTC") {
  return calendarWeek(zonedDay(date, timeZone));
}
/** Calendar addition respects 23/25-hour and half-hour daylight-saving days. */
export function nextZonedDayBoundary(date: Date, timeZone: string): number {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ days: 1 })
    .toZonedDateTime(timeZone).epochMilliseconds;
}
export function calendarRefreshDelay(date: Date, timeZone: string): number {
  const timestamp = date.getTime();
  return Math.max(
    1,
    Math.min(
      60000 - (timestamp % 60000),
      nextZonedDayBoundary(date, timeZone) - timestamp,
    ) + 10,
  );
}
export function reminderLocalInput(instant: string, timeZone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function reminderInstant(local: string, timeZone: string) {
  try {
    return Temporal.PlainDateTime.from(local)
      .toZonedDateTime(timeZone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    throw new Error(
      "Choose a valid, unambiguous reminder time in the displayed time zone.",
    );
  }
}
/** An untouched repeated-hour reminder retains its original occurrence and seconds. */
export function editedReminderInstant(
  local: string,
  original: string | null | undefined,
  timeZone: string,
): string | null {
  if (!local) return null;
  if (original && reminderLocalInput(original, timeZone) === local)
    return original;
  return reminderInstant(local, timeZone);
}
export function weekBounds(weekStart: string, timeZone = "UTC") {
  timeZoneInput.parse(timeZone);
  const start = Temporal.PlainDate.from(weekStart);
  if (start.dayOfWeek !== 1) throw new Error("Choose a Monday week start");
  const days = Array.from({ length: 7 }, (_, i) =>
    start.add({ days: i }).toString(),
  );
  return {
    start: start
      .toZonedDateTime(timeZone)
      .toInstant()
      .toString({ smallestUnit: "millisecond" }),
    end: start
      .add({ days: 7 })
      .toZonedDateTime(timeZone)
      .toInstant()
      .toString({ smallestUnit: "millisecond" }),
    days,
  };
}
