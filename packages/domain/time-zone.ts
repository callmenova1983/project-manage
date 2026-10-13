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
