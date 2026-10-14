import { ref } from "vue";
import { zonedDay, zonedWeek } from "../../../../packages/domain/time-zone";
export const workspaceTimeZone = ref("UTC");
export const currentDay = (date = new Date()) =>
  zonedDay(date, workspaceTimeZone.value);
export const currentWeek = (date = new Date()) =>
  zonedWeek(date, workspaceTimeZone.value);
