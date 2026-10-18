import { projectChannel } from "./channels.js";
import { matchesProjectPinyin } from "./project-search.js";
import { orderedProjectIds } from "./project-order.js";
import { stageSummaries } from "./stage-summary.js";
import { createTaskViewIndex, type TaskViewQuery } from "./task-view.js";
import type { Member, Project, Snapshot } from "./types.js";

export interface ProjectViewFilters {
  query?: string;
  stage?: string;
  owner?: string;
  discipline?: string;
  category?: string;
  channel?: string;
  followedOnly?: boolean;
  sort?: "manual" | "updated" | "name";
  invalid?: boolean;
}
const projectFilterKeys = [
  "q",
  "stage",
  "owner",
  "discipline",
  "category",
  "channel",
  "follow",
  "sort",
] as const;
export function hasProjectViewQuery(query: Record<string, unknown>) {
  return projectFilterKeys.some((key) => query[key] !== undefined);
}
export function readProjectViewQuery(
  query: Record<string, unknown>,
): ProjectViewFilters {
  const text = (key: string) =>
    typeof query[key] === "string" ? (query[key] as string) : "";
  return {
    query: text("q"),
    stage: text("stage"),
    owner: text("owner"),
    discipline: text("discipline"),
    category: text("category"),
    channel: text("channel"),
    followedOnly: text("follow") === "1",
    sort: ["manual", "updated", "name"].includes(text("sort"))
      ? (text("sort") as ProjectViewFilters["sort"])
      : "manual",
    invalid:
      projectFilterKeys.some(
        (key) => query[key] !== undefined && typeof query[key] !== "string",
      ) ||
      (query.follow !== undefined && !["", "0", "1"].includes(text("follow"))),
  };
}
export function projectViewQuery(filters: ProjectViewFilters) {
  return {
    q: filters.query || undefined,
    stage: filters.stage || undefined,
    owner: filters.owner || undefined,
    discipline: filters.discipline || undefined,
    category: filters.category || undefined,
    channel: filters.channel || undefined,
    follow: filters.followedOnly ? "1" : undefined,
    sort: filters.sort && filters.sort !== "manual" ? filters.sort : undefined,
  };
}
export function projectOwnerKey(project: Project): string {
  return JSON.stringify(
    project.ownerId ? ["member", project.ownerId] : ["text", project.owner],
  );
}
export function selectProjects(
  projects: readonly Project[],
  members: readonly Member[] = [],
  filters: ProjectViewFilters = {},
  following: ReadonlySet<string> = new Set(),
  order?: string[],
): Project[] {
  if (filters.invalid) return [];
  const names = new Map(members.map((member) => [member.id, member.name]));
  const ranks = new Map(
    orderedProjectIds([...projects], order).map((id, rank) => [id, rank]),
  );
  const query = filters.query?.trim().toLocaleLowerCase();
  return projects
    .filter(
      (project) =>
        (!query ||
          `${project.name} ${project.shortName ?? ""} ${project.aliases.join(" ")} ${project.client} ${project.latestUpdate} ${(project.ownerId && names.get(project.ownerId)) || project.owner}`
            .toLocaleLowerCase()
            .includes(query) ||
          matchesProjectPinyin(project, query)) &&
        (!filters.stage || project.stage === filters.stage) &&
        (!filters.channel || projectChannel(project) === filters.channel) &&
        (!filters.category ||
          project.categoryIds?.includes(filters.category)) &&
        (!filters.discipline || project.discipline === filters.discipline) &&
        (!filters.followedOnly || following.has(project.id)) &&
        (!filters.owner ||
          projectOwnerKey(project) === filters.owner ||
          (project.ownerId
            ? `member:${project.ownerId}` === filters.owner
            : project.owner === filters.owner ||
              `text:${project.owner}` === filters.owner)),
    )
    .sort((a, b) => {
      const result =
        filters.sort === "name"
          ? a.name.localeCompare(b.name)
          : filters.sort === "updated"
            ? (b.reportedAt ?? "").localeCompare(a.reportedAt ?? "")
            : (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0);
      return result || a.id.localeCompare(b.id);
    });
}

/** Overview and drill-down share the same project set and full task graph. */
export function projectWorkspaceOverview(
  snapshot: Pick<Snapshot, "projects" | "tasks" | "members">,
  selectedProjects: readonly Project[],
  context: {
    now?: Date;
    timeZone?: string;
    scope?: "all" | "week" | "today";
  } = {},
) {
  const projects = selectedProjects.filter((project) => !project.intakeInbox);
  const ids = new Set(projects.map((project) => project.id));
  const index = createTaskViewIndex(snapshot.tasks, {
    ...context,
    members: snapshot.members,
  });
  const query: TaskViewQuery = {
    scope: context.scope ?? "week",
    status: "",
    project: "",
    query: "",
    focus: "all",
  };
  const tasks = index.select(query).filter((task) => ids.has(task.projectId));
  const leafIds = new Set(tasks.map((task) => task.id));
  const parentIds = new Set(
    snapshot.tasks.map((task) => task.parentId).filter(Boolean),
  );
  const summarize = (rows: typeof tasks) => ({
    total: rows.length,
    open: rows.filter((task) => task.status !== "done"),
    done: rows.filter((task) => task.status === "done"),
    blocked: rows.filter((task) => task.status === "blocked"),
    overdue: rows.filter(
      (task) =>
        task.status !== "done" && task.dueDate && task.dueDate < index.today,
    ),
    unplanned: rows.filter(
      (task) =>
        task.status !== "done" && !task.workWeek && !task.workDates.length,
    ),
  });
  const allTasks = index
    .select({ ...query, scope: "all" })
    .filter((task) => ids.has(task.projectId));
  return {
    projects,
    projectIds: projects.map((project) => project.id),
    tasks,
    selected: summarize(tasks),
    all: summarize(allTasks),
    today: index.today,
    week: index.week,
    stages: stageSummaries(
      projects,
      snapshot.tasks,
      context.now,
      context.timeZone,
    ),
    recentProjects: projects
      .filter((project) => project.latestUpdate.trim())
      .sort(
        (a, b) =>
          (b.reportedAt ?? "").localeCompare(a.reportedAt ?? "") ||
          a.id.localeCompare(b.id),
      ),
    // Keep full graph available for tree context; never derive parents from a filtered subset.
    contextTasks: snapshot.tasks.filter(
      (task) =>
        ids.has(task.projectId) &&
        (leafIds.has(task.id) || parentIds.has(task.id)),
    ),
  };
}
