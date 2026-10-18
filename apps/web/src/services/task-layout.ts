export const ganttEnabled = import.meta.env.VITE_ENABLE_GANTT !== "0";
export function taskLayouts(enabled: boolean) {
  return enabled
    ? (["list", "board", "calendar", "gantt"] as const)
    : (["list", "board", "calendar"] as const);
}
export function resolveTaskLayout(value: unknown, enabled: boolean) {
  const available = taskLayouts(enabled);
  const valid =
    typeof value === "string" && available.some((layout) => layout === value);
  return {
    layout: valid
      ? (value as "list" | "board" | "calendar" | "gantt")
      : ("list" as const),
    unavailable: !valid,
  };
}
