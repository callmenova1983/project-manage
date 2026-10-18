import type { TaskFilters } from "./task-focus";
export const taskPresets = [
  "mine",
  "coordination",
  "overdue",
  "unassigned",
] as const;
export type TaskPreset = (typeof taskPresets)[number];
const definitions: Record<
  TaskPreset,
  Pick<TaskFilters, "scope" | "status" | "focus" | "assignee" | "risk">
> = {
  mine: { scope: "all", status: "", focus: "open", assignee: "me", risk: "" },
  coordination: {
    scope: "week",
    status: "blocked",
    focus: "all",
    assignee: "",
    risk: "",
  },
  overdue: {
    scope: "all",
    status: "",
    focus: "open",
    assignee: "",
    risk: "overdue",
  },
  unassigned: {
    scope: "all",
    status: "",
    focus: "open",
    assignee: "none",
    risk: "",
  },
};
/** Presets start from explicit rules rather than inheriting conflicting filters. */
export function taskPresetQuery(
  preset: TaskPreset,
  current: Record<string, unknown>,
) {
  const definition = definitions[preset];
  const display = Object.fromEntries(
    [
      "view",
      "dateBasis",
      "date",
      "calendarMode",
      "intake",
      "group",
      "sort",
      "density",
      "columns",
    ]
      .filter((key) => typeof current[key] === "string")
      .map((key) => [key, current[key] as string]),
  );
  return {
    ...display,
    scope: definition.scope,
    status: definition.status || undefined,
    focus: definition.focus === "all" ? undefined : definition.focus,
    assignee: definition.assignee || undefined,
    risk: definition.risk || undefined,
  };
}
export function activeTaskPreset(
  filters: TaskFilters,
  projectId = "",
): TaskPreset | undefined {
  if (
    filters.project !== projectId ||
    filters.projects !== undefined ||
    filters.query
  )
    return;
  return taskPresets.find((preset) => {
    const expected = definitions[preset];
    return (
      filters.scope === expected.scope &&
      filters.status === expected.status &&
      filters.focus === expected.focus &&
      (filters.assignee || "") === expected.assignee &&
      (filters.risk || "") === expected.risk
    );
  });
}
