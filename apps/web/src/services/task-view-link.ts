import {
  readTaskListPresentation,
  taskListPresentationQuery,
  type TaskListPresentation,
} from "./task-list-presentation";

/** Freeze the rendered layout, including values resolved from private defaults. */
export function taskViewLink(
  href: string,
  query: Record<string, unknown>,
  layout: string,
  defaults: TaskListPresentation,
  resolved: { scope: string; calendarMode: string },
) {
  const url = new URL(href);
  const presentation = readTaskListPresentation(query, defaults);
  for (const [key, value] of Object.entries({
    ...taskListPresentationQuery(presentation.value),
    view: layout,
    scope: resolved.scope,
    ...(layout === "calendar"
      ? {
          dateBasis:
            typeof query.dateBasis === "string" ? query.dateBasis : "due",
          calendarMode:
            typeof query.calendarMode === "string"
              ? query.calendarMode
              : resolved.calendarMode,
        }
      : {}),
  }))
    url.searchParams.set(key, value);
  return url.href;
}
