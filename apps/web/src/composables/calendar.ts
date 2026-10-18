import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  calendarRefreshDelay,
  zonedDay,
  zonedWeek,
} from "../../../../packages/domain/time-zone";
export const workspaceTimeZone = ref("UTC");
export const currentDay = (date = new Date()) =>
  zonedDay(date, workspaceTimeZone.value);
export const currentWeek = (date = new Date()) =>
  zonedWeek(date, workspaceTimeZone.value);

/** Recalculate at workspace midnight, minute ticks, zone changes and foreground. */
export function useCalendarNow() {
  const now = ref(new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false;
  function refresh() {
    if (timer) clearTimeout(timer);
    now.value = new Date();
    timer = setTimeout(
      refresh,
      calendarRefreshDelay(now.value, workspaceTimeZone.value),
    );
  }
  function foreground() {
    if (document.visibilityState === "visible") refresh();
  }
  onMounted(() => {
    mounted = true;
    refresh();
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("focus", refresh);
  });
  watch(workspaceTimeZone, () => {
    if (mounted) refresh();
  });
  onUnmounted(() => {
    mounted = false;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("focus", refresh);
  });
  return now;
}
