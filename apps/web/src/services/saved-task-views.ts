import { z } from "zod";
import {
  taskListQuerySchema,
  readTaskListPresentation,
  taskListPresentationQuery,
  type TaskListPresentation,
} from "./task-list-presentation";
import { dateSchema } from "../../../../packages/domain/types";
import { readTaskFilters } from "../composables/task-focus";
const id = z.string().min(1).max(100);
const querySchema = z
  .object({
    ...taskListQuerySchema.shape,
    view: z.enum(["list", "board", "calendar", "gantt"]).optional(),
    scope: z.enum(["today", "week", "all"]).optional(),
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
    focus: z.enum(["all", "open", "done"]).optional(),
    assignee: z
      .string()
      .min(1)
      .max(160)
      .regex(/^(me|none|member:.+|text:.+)$/)
      .optional(),
    risk: z.enum(["overdue", "unplanned", "blocked"]).optional(),
    project: id.optional(),
    projects: z.array(id).max(1000).optional(),
    q: z.string().max(1000).optional(),
    dateBasis: z.enum(["due", "work", "estimated", "reminder"]).optional(),
    calendarMode: z.enum(["month", "week", "agenda"]).optional(),
    date: dateSchema.optional(),
    ganttDate: dateSchema.optional(),
    ganttScale: z.enum(["day", "week", "month"]).optional(),
  })
  .strict();
const savedSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(40),
    context: z.enum(["tasks", "projectTasks"]),
    anchorMode: z.enum(["relative", "absolute"]),
    query: querySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.context === "projectTasks" &&
      (value.query.project !== undefined || value.query.projects !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Project templates cannot contain project IDs",
      });
    if (
      value.anchorMode === "relative" &&
      (value.query.date !== undefined || value.query.ganttDate !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Relative views cannot contain a fixed date",
      });
    if (
      value.anchorMode === "absolute" &&
      !(value.query.view === "gantt" ? value.query.ganttDate : value.query.date)
    )
      context.addIssue({ code: "custom", message: "Choose a fixed date" });
  });
const envelope = z
  .object({
    version: z.literal(1),
    views: z
      .array(savedSchema)
      .max(20)
      .refine(
        (views) => new Set(views.map((view) => view.id)).size === views.length,
      ),
  })
  .strict();
export type SavedTaskView = z.infer<typeof savedSchema>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const maximum = 64000;
const invalid =
  "Saved filters are invalid or use a newer version. Your stored data has been preserved.";
export function readSavedTaskViews(
  storage: StorageLike,
  key: string,
): { views: SavedTaskView[]; error: string } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { views: [], error: "" };
    if (raw.length > maximum) return { views: [], error: invalid };
    return { views: envelope.parse(JSON.parse(raw)).views, error: "" };
  } catch {
    return { views: [], error: invalid };
  }
}
export function writeSavedTaskViews(
  storage: StorageLike,
  key: string,
  views: SavedTaskView[],
): string {
  try {
    // Never replace unreadable data with an apparently empty collection.
    if (readSavedTaskViews(storage, key).error) return invalid;
    const raw = JSON.stringify(envelope.parse({ version: 1, views }));
    if (raw.length > maximum)
      return "Saved filters exceed the browser storage limit.";
    storage.setItem(key, raw);
    return "";
  } catch {
    return "Filters could not be saved. Use at most 20 names of 1–40 characters.";
  }
}
export function captureTaskView(
  context: SavedTaskView["context"],
  query: Record<string, unknown>,
  layout: string,
  absolute: boolean,
  presentation?: TaskListPresentation,
): Pick<SavedTaskView, "context" | "anchorMode" | "query"> {
  try {
    querySchema.parse(
      Object.fromEntries(
        Object.entries(query).filter(
          ([key]) =>
            key in querySchema.shape &&
            !(
              context === "projectTasks" &&
              ["project", "projects"].includes(key)
            ),
        ),
      ),
    );
    const filters = readTaskFilters(query);
    const display = presentation
      ? taskListPresentationQuery(
          readTaskListPresentation(query, presentation).value,
        )
      : taskListQuerySchema.parse(
          Object.fromEntries(
            Object.entries(query).filter(
              ([key]) => key in taskListQuerySchema.shape,
            ),
          ),
        );
    const captured = querySchema.parse({
      ...display,
      view: layout,
      scope: filters.scope,
      status: filters.status || undefined,
      focus: filters.focus === "all" ? undefined : filters.focus,
      assignee: filters.assignee || undefined,
      risk: filters.risk || undefined,
      q: filters.query || undefined,
      ...(context === "tasks"
        ? {
            project: filters.project || undefined,
            projects: filters.projects ? [...filters.projects] : undefined,
          }
        : {}),
      dateBasis: query.dateBasis,
      calendarMode: query.calendarMode,
      ganttScale: query.ganttScale,
      ...(absolute
        ? layout === "gantt"
          ? { ganttDate: query.ganttDate }
          : { date: query.date }
        : {}),
    });
    const value = {
      context,
      anchorMode: absolute ? ("absolute" as const) : ("relative" as const),
      query: captured,
    };
    savedSchema.parse({ id: "validation", name: "validation", ...value });
    return value;
  } catch {
    throw new Error(
      "The current filter rules are invalid. Correct them before saving.",
    );
  }
}
export function savedTaskViewQuery(
  view: SavedTaskView,
  available: { projects: readonly string[]; members: readonly string[] },
) {
  const valid = savedSchema.parse(view);
  const projectIds = new Set(available.projects);
  if (
    (valid.query.project && !projectIds.has(valid.query.project)) ||
    valid.query.projects?.some((id) => !projectIds.has(id)) ||
    (valid.query.assignee?.startsWith("member:") &&
      !available.members.includes(valid.query.assignee.slice(7)))
  )
    throw new Error(
      "This saved filter references an unavailable project or member. Update its rules before applying.",
    );
  return {
    ...valid.query,
    projects: valid.query.projects?.length === 0 ? [""] : valid.query.projects,
  };
}
