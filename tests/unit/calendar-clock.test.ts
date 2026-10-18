import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { effectScope, nextTick, type EffectScope } from "vue";
const hooks = vi.hoisted(() => ({
  mounted: [] as (() => void)[],
  unmounted: [] as (() => void)[],
}));
vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  onMounted: (fn: () => void) => hooks.mounted.push(fn),
  onUnmounted: (fn: () => void) => hooks.unmounted.push(fn),
}));
import {
  currentDay,
  useCalendarNow,
  workspaceTimeZone,
} from "../../apps/web/src/composables/calendar";
let scope: EffectScope;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  workspaceTimeZone.value = "Asia/Shanghai";
  hooks.mounted.length = hooks.unmounted.length = 0;
  scope = effectScope();
});
afterEach(() => {
  hooks.unmounted.forEach((fn) => fn());
  scope.stop();
  workspaceTimeZone.value = "UTC";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("refreshes workspace day and week immediately after midnight without business writes", () => {
  vi.setSystemTime(new Date("2026-10-18T15:59:59.750Z"));
  const now = scope.run(() => useCalendarNow())!;
  hooks.mounted.forEach((fn) => fn());
  expect(currentDay(now.value)).toBe("2026-10-18");
  vi.advanceTimersByTime(260);
  expect(currentDay(now.value)).toBe("2026-10-19");
  expect(vi.getTimerCount()).toBe(1);
});
it("reschedules on a zone change and refreshes on focus or visible foreground", async () => {
  vi.setSystemTime(new Date("2026-10-18T16:00:00Z"));
  const now = scope.run(() => useCalendarNow())!;
  hooks.mounted.forEach((fn) => fn());
  workspaceTimeZone.value = "UTC";
  await nextTick();
  expect(currentDay(now.value)).toBe("2026-10-18");
  expect(vi.getTimerCount()).toBe(1);
  vi.setSystemTime(new Date("2026-10-19T02:00:00Z"));
  window.dispatchEvent(new Event("focus"));
  expect(now.value.toISOString()).toBe("2026-10-19T02:00:00.000Z");
  vi.setSystemTime(new Date("2026-10-20T03:00:00Z"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(currentDay(now.value)).toBe("2026-10-20");
});
it("removes timer and foreground listeners on unmount", () => {
  const now = scope.run(() => useCalendarNow())!;
  hooks.mounted.forEach((fn) => fn());
  hooks.unmounted.forEach((fn) => fn());
  expect(vi.getTimerCount()).toBe(0);
  const previous = now.value.getTime();
  vi.setSystemTime(previous + 86400000);
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(now.value.getTime()).toBe(previous);
});
