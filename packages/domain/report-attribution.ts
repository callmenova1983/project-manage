import { Temporal } from "@js-temporal/polyfill";
import { calendarWeek, zonedDay } from "./time-zone.js";
import type { ProgressSource } from "./progress-material.js";
import type { Member, Proposal, Suggestion, Task } from "./types.js";

/** Only source metadata, never reviewed/client fields, determines attribution. */
export function attributedReportSuggestion(
  suggestion: Suggestion,
  proposal: Proposal,
  timeZone: string,
): Suggestion {
  if (
    !suggestion.dailyReport ||
    suggestion.workDate ||
    suggestion.invalidWorkDate
  )
    return suggestion;
  return {
    ...suggestion,
    workDate: zonedDay(new Date(proposal.createdAt), timeZone),
  };
}

export function reportTaskAssignment(
  suggestion: Suggestion,
  members: readonly Member[],
) {
  const assignee =
    suggestion.assignee?.trim() || suggestion.reporter?.trim() || "Unassigned";
  if (!suggestion.dailyReport) return { assignee };
  const matches = members.filter(
    (member) => member.status === "active" && member.name === assignee,
  );
  return { assignee, assigneeId: matches.length === 1 ? matches[0]!.id : null };
}

export function matchingReportTask(
  suggestion: Suggestion,
  tasks: readonly Task[],
  projectId: string,
  title: string,
  assignment: { assignee: string; assigneeId?: string | null },
) {
  if (!suggestion.dailyReport) return undefined;
  const workWeek = reportWorkWeek(suggestion, title);
  if (!workWeek && /下周|下星期|本周|这周/.test(title)) return undefined;
  const parents = new Set(
    tasks
      .filter((task) => !task.voided && task.parentId)
      .map((task) => task.parentId),
  );
  const matches = tasks.filter(
    (task) =>
      task.projectId === projectId &&
      task.title === title &&
      task.assignee === assignment.assignee &&
      (!task.assigneeId || task.assigneeId === assignment.assigneeId) &&
      !task.voided &&
      task.status !== "done" &&
      !parents.has(task.id) &&
      (!workWeek || task.workWeek === workWeek),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function reportWorkWeek(suggestion: Suggestion, title: string) {
  if (
    !suggestion.dailyReport ||
    !suggestion.workDate ||
    suggestion.invalidWorkDate
  )
    return null;
  const next = /下周|下星期/.test(title);
  const current = /本周|这周/.test(title);
  if (next === current) return null;
  try {
    return Temporal.PlainDate.from(calendarWeek(suggestion.workDate))
      .add({ days: next ? 7 : 0 })
      .toString();
  } catch {
    return null;
  }
}

export function reportProgressSource(
  proposal: Proposal,
  suggestion: Suggestion,
  sourceTexts: readonly string[] = [suggestion.sourceText],
): ProgressSource | undefined {
  if (!suggestion.dailyReport) return undefined;
  const fullText = proposal.originalSource?.text || proposal.source;
  // When a whole imported report is longer than the progress-source limit,
  // retain the complete original lines for this particular author/date group.
  const relevantText =
    fullText.length <= 12000 ? fullText : [...new Set(sourceTexts)].join("\n");
  const notice = `【原文较长，以下为节选；完整原文保存在来源记录 ${proposal.id} 中。】\n`;
  return {
    text:
      relevantText.length <= 12000
        ? relevantText
        : notice + relevantText.slice(0, 12000 - notice.length),
    materialIds: proposal.originalSource?.materialIds ?? [],
    ...(proposal.originalSource?.recognitionDepth
      ? { recognitionDepth: proposal.originalSource.recognitionDepth }
      : {}),
    ...(suggestion.workDate && !suggestion.invalidWorkDate
      ? { workDate: suggestion.workDate }
      : {}),
  };
}

export function reportProgressKey(projectId: string, suggestion: Suggestion) {
  return JSON.stringify([
    projectId,
    suggestion.dailyReport ?? false,
    suggestion.reporter ?? null,
    suggestion.workDate ?? null,
    suggestion.invalidWorkDate ?? false,
  ]);
}

/** Keep runtime callers from replacing source-derived metadata in local mode. */
export function saveReviewedReportSuggestion(
  source: Suggestion,
  reviewed: Pick<
    Suggestion,
    | "id"
    | "selectedProjectId"
    | "title"
    | "action"
    | "status"
    | "confirmed"
    | "overwriteConfirmed"
  >,
): Suggestion {
  return {
    ...source,
    id: reviewed.id,
    selectedProjectId: reviewed.selectedProjectId,
    title: reviewed.title,
    action: reviewed.action,
    status: reviewed.status,
    confirmed: reviewed.confirmed,
    overwriteConfirmed: reviewed.overwriteConfirmed,
  };
}
