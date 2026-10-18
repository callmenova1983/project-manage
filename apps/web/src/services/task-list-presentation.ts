import { z } from "zod";
import {
  viewPreferencesSchema,
  type ViewPreferences,
} from "./view-preferences";
export type TaskListPresentation = Pick<
  ViewPreferences,
  "taskGroup" | "taskSort" | "density" | "taskColumns"
>;
const presentationSchema = viewPreferencesSchema.pick({
  taskGroup: true,
  taskSort: true,
  density: true,
  taskColumns: true,
});
export const taskListQuerySchema = z
  .object({
    group: viewPreferencesSchema.shape.taskGroup.optional(),
    sort: viewPreferencesSchema.shape.taskSort.optional(),
    density: viewPreferencesSchema.shape.density.optional(),
    columns: z
      .string()
      .max(128)
      .refine(
        (value) =>
          viewPreferencesSchema.shape.taskColumns.safeParse(
            value ? value.split(",") : [],
          ).success,
      )
      .optional(),
  })
  .strict();
export function readTaskListPresentation(
  query: Record<string, unknown>,
  fallback: TaskListPresentation,
): { value: TaskListPresentation; error: string } {
  const parsed = taskListQuerySchema.safeParse(
    Object.fromEntries(
      ["group", "sort", "density", "columns"]
        .filter((key) => query[key] !== undefined)
        .map((key) => [key, query[key]]),
    ),
  );
  if (!parsed.success)
    return {
      value: {
        taskGroup: fallback.taskGroup,
        taskSort: fallback.taskSort,
        density: fallback.density,
        taskColumns: [...fallback.taskColumns],
      },
      error:
        "List display parameters are invalid. Personal defaults are shown.",
    };
  return {
    value: {
      taskGroup: parsed.data.group ?? fallback.taskGroup,
      taskSort: parsed.data.sort ?? fallback.taskSort,
      density: parsed.data.density ?? fallback.density,
      taskColumns:
        parsed.data.columns === undefined
          ? [...fallback.taskColumns]
          : parsed.data.columns
            ? (parsed.data.columns.split(
                ",",
              ) as TaskListPresentation["taskColumns"])
            : [],
    },
    error: "",
  };
}
export function taskListPresentationQuery(value: TaskListPresentation) {
  const valid = presentationSchema.parse(value);
  return {
    group: valid.taskGroup,
    sort: valid.taskSort,
    density: valid.density,
    columns: valid.taskColumns.join(","),
  };
}
