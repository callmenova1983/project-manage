import { z } from "zod";
import type { Project, Task } from "./types.js";

export type ProjectLifecycle = "active" | "closed" | "archived";
export const projectLifecycleLabels = {
  active: "Active project",
  closed: "Closed project",
  archived: "Archived project",
} as const;
export const projectLifecycleActions = {
  active: "Reactivated project",
  closed: "Closed project",
  archived: "Archived project",
} as const;
export const projectLifecycleInput = z
  .object({
    version: z.number().int().positive(),
    lifecycle: z.enum(["active", "closed", "archived"]),
    confirmOpenTasks: z.boolean().optional(),
  })
  .strict();
export type ProjectLifecycleInput = z.infer<typeof projectLifecycleInput>;

export function projectLifecycle(
  project: Pick<Project, "lifecycle">,
): ProjectLifecycle {
  return project.lifecycle ?? "active";
}
export function isActiveProject(project: Pick<Project, "lifecycle">) {
  return projectLifecycle(project) === "active";
}
export class ProjectLifecycleError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public current?: Project,
  ) {
    super(message);
  }
}
export function assertProjectWritable(project: Project) {
  if (projectLifecycle(project) === "archived")
    throw new ProjectLifecycleError(
      "This project is archived. Restore it before editing.",
      409,
      project,
    );
}
/** Count open leaves, excluding voided work and summary parents. */
export function projectOpenTasks(projectId: string, tasks: readonly Task[]) {
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  return tasks.filter(
    (task) =>
      task.projectId === projectId &&
      !task.voided &&
      task.status !== "done" &&
      !parents.has(task.id),
  );
}
export function planProjectLifecycle(
  project: Project,
  tasks: readonly Task[],
  raw: ProjectLifecycleInput,
  now = new Date().toISOString(),
): Project {
  const input = projectLifecycleInput.parse(raw);
  if (project.version !== input.version)
    throw new ProjectLifecycleError(
      "This project changed. Refresh before changing its status.",
      409,
      project,
    );
  if (project.intakeInbox)
    throw new ProjectLifecycleError(
      "Unassigned work cannot be closed or archived.",
    );
  if (projectLifecycle(project) === input.lifecycle) return project;
  if (
    input.lifecycle !== "active" &&
    projectOpenTasks(project.id, tasks).length &&
    !input.confirmOpenTasks
  )
    throw new ProjectLifecycleError(
      "Review the unfinished tasks and confirm before closing or archiving this project.",
      409,
      project,
    );
  return {
    ...project,
    lifecycle: input.lifecycle,
    lifecycleChangedAt: now,
    updatedAt: now,
    version: project.version + 1,
  };
}
