import { weekKey, type Activity, type Project, type Task } from "./types.js";

import { weekBounds, zonedDay } from "./time-zone.js";

export type ActivityTone =
  | "completed"
  | "task"
  | "project"
  | "stage"
  | "import"
  | "restored"
  | "proposal";

export interface ActivityDescription {
  key: string;
  tone: ActivityTone;
  /** Only system labels belong here; user-authored content stays in subject. */
  params?: Record<string, string>;
  subject: string | null;
}

export interface WeeklyActivitySummary {
  weekStart: string;
  events: Activity[];
  changeCount: number;
  projectCount: number;
  completionActions: number;
  days: { date: string; count: number }[];
}

function isTask(value: Activity["before"]): value is Task {
  return value !== null && "status" in value && "projectId" in value;
}

function isProject(value: Activity["before"]): value is Project {
  return value !== null && "stage" in value && "name" in value;
}

export function isHistoryRestore(activity: Activity): boolean {
  return (
    activity.source === "History restore" ||
    activity.action === "Restored previous version"
  );
}

/** Counts saved transitions, never inferred completed tasks or imported totals. */
export function isCompletionAction(activity: Activity): boolean {
  const { before, after } = activity;
  return (
    activity.kind === "task" &&
    !isHistoryRestore(activity) &&
    isTask(before) &&
    isTask(after) &&
    before.id === activity.entityId &&
    after.id === activity.entityId &&
    before.projectId === after.projectId &&
    after.projectId === activity.projectId &&
    after.version > before.version &&
    before.status !== "done" &&
    after.status === "done"
  );
}

const statusLabels: Record<Task["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  blocked: "Needs coordination",
};
const stageLabels: Record<Project["stage"], string> = {
  potential: "Potential demand",
  proposal: "Proposal & quotation",
  approved: "Approved · awaiting delivery",
  implementation: "In delivery",
  operations: "Operations",
};

export function describeActivity(activity: Activity): ActivityDescription {
  const { before, after } = activity;
  const subject = isTask(after)
    ? after.title
    : isTask(before)
      ? before.title
      : isProject(after)
        ? after.name
        : isProject(before)
          ? before.name
          : null;
  if (isHistoryRestore(activity))
    return { key: "Previous version restored", tone: "restored", subject };
  if (activity.kind === "import")
    return { key: "Workspace imported", tone: "import", subject: null };
  if (activity.kind === "proposal")
    return { key: "Meeting suggestions updated", tone: "proposal", subject };
  if (activity.kind === "task") {
    if (isCompletionAction(activity))
      return { key: "Task marked done", tone: "completed", subject };
    if (isTask(before) && isTask(after) && before.status !== after.status)
      return {
        key: "Task status: {status}",
        params: { status: statusLabels[after.status] },
        tone: "task",
        subject,
      };
    return {
      key: before ? (after ? "Task updated" : "Task removed") : "Task added",
      tone: "task",
      subject,
    };
  }
  if (isProject(before) && isProject(after)) {
    if (before.stage !== after.stage)
      return {
        key: "Stage changed: {stage}",
        params: { stage: stageLabels[after.stage] ?? after.stage },
        tone: "stage",
        subject,
      };
    if (before.latestUpdate !== after.latestUpdate)
      return { key: "Project update reported", tone: "project", subject };
  }
  if (activity.action === "Reported an update")
    return { key: "Project update reported", tone: "project", subject };
  return {
    key: before
      ? after
        ? "Project updated"
        : "Project removed"
      : "Project added",
    tone: "project",
    subject,
  };
}

/**
 * Aggregate the complete supplied range; never cap history before filtering.
 * Project.reportedAt and current task state are deliberately not consulted.
 */
export function summarizeWeeklyActivity(
  activities: readonly Activity[],
  options: {
    now?: Date;
    timeZone?: string;
    weekStart?: string;
    projectIds?: readonly string[];
  } = {},
): WeeklyActivitySummary {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "UTC";
  const weekStart = options.weekStart ?? weekKey(now, timeZone);
  const bounds = weekBounds(weekStart, timeZone);
  const startMs = Date.parse(bounds.start);
  const endMs = Date.parse(bounds.end);
  const scope = options.projectIds ? new Set(options.projectIds) : null;
  const seenIds = new Set<string>();
  const events = [...activities]
    .filter((activity) => Number.isFinite(Date.parse(activity.createdAt)))
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .filter((activity) => {
      if (seenIds.has(activity.id)) return false;
      seenIds.add(activity.id);
      return true;
    })
    .filter((activity) => {
      const timestamp = Date.parse(activity.createdAt);
      return (
        activity.source !== "Synthetic demo seed" &&
        timestamp >= startMs &&
        timestamp < endMs &&
        timestamp <= now.getTime() &&
        (!scope ||
          (activity.projectId !== null && scope.has(activity.projectId)))
      );
    });
  // Retried copies of the same task version transition are one action. A later
  // reopen and completion has new versions, so it remains a separate action.
  const completionVersions = new Set<string>();
  const days = bounds.days.map((date) => ({ date, count: 0 }));
  const dayCounts = new Map(days.map((day) => [day.date, day]));
  for (const activity of events) {
    dayCounts.get(zonedDay(new Date(activity.createdAt), timeZone))!.count++;
    if (isCompletionAction(activity)) {
      completionVersions.add(
        `${activity.entityId}:${activity.before!.version}:${activity.after!.version}`,
      );
    }
  }
  return {
    weekStart,
    events,
    changeCount: events.length,
    projectCount: new Set(
      events.map((activity) => activity.projectId).filter(Boolean),
    ).size,
    completionActions: completionVersions.size,
    days,
  };
}
