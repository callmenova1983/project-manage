import type {
  Project,
  Proposal,
  Status,
} from "../../../../packages/domain/types";
import type { IntakeBatch } from "../../../../packages/domain/intake";
import type { DailyLogBatch } from "../../../../packages/domain/daily-log";

export interface CaptureResult {
  key: string;
  kind: "project" | "task" | "update" | "skipped" | "pending";
  title: string;
  projectName: string;
  projectId?: string;
  taskId?: string;
  status?: Status;
  assignee?: string;
  reporter?: string;
  workDate?: string;
  dailyReport?: boolean;
  linked?: boolean;
}
function destination(id: string | undefined, projects: Project[]) {
  const project = projects.find((p) => p.id === id);
  return {
    projectName: project?.shortName || project?.name || "待明确项目",
    // A removed or unavailable project must not produce a broken link.
    ...(project ? { projectId: project.id } : {}),
  };
}
export function resultLocation(row: CaptureResult) {
  if (!row.projectId) return undefined;
  const path = `/projects/${encodeURIComponent(row.projectId)}`;
  if (row.taskId) return `${path}#task-${encodeURIComponent(row.taskId)}`;
  return row.kind === "update" ? `${path}#progress-history` : path;
}
export function meetingResults(
  proposal: Proposal,
  projects: Project[],
): CaptureResult[] {
  const applied = new Set(
    proposal.appliedSuggestionIds ??
      (proposal.status === "applied"
        ? proposal.suggestions.map((s) => s.id)
        : []),
  );
  const skipped = new Set(proposal.skippedSuggestionIds ?? []);
  const destinations = new Map(
    proposal.appliedResults?.map((r) => [r.suggestionId, r]),
  );
  return [
    ...(proposal.createdProjectIds ?? []).map((id): CaptureResult => ({
      key: `project:${id}`,
      kind: "project",
      title: projects.find((p) => p.id === id)?.name ?? "新建项目",
      ...destination(id, projects),
    })),
    ...proposal.suggestions.flatMap((s): CaptureResult[] => {
      if (!applied.has(s.id) && !skipped.has(s.id)) return [];
      const saved = destinations.get(s.id);
      const target = destination(
        saved?.projectId ?? s.selectedProjectId,
        projects,
      );
      const kind = skipped.has(s.id) ? "skipped" : s.action;
      return [
        {
          key: `suggestion:${s.id}`,
          kind,
          title: s.title,
          ...target,
          ...(s.dailyReport
            ? {
                dailyReport: true,
                assignee: s.assignee || s.reporter,
                reporter: s.reporter,
                workDate: s.workDate,
              }
            : {}),
          ...(kind === "task"
            ? {
                status: s.status,
                taskId: saved?.taskId,
                ...(saved?.taskDisposition === "linked"
                  ? { linked: true }
                  : {}),
              }
            : {}),
        },
      ];
    }),
  ];
}
export function intakeResults(
  batch: IntakeBatch,
  projects: Project[],
): CaptureResult[] {
  return [
    ...batch.projects
      .filter((p) => !p.intakeInbox)
      .map((p): CaptureResult => ({
        key: `project:${p.id}`,
        kind: "project",
        title: p.name,
        ...destination(p.id, projects),
      })),
    ...batch.tasks.map((task): CaptureResult => ({
      key: `task:${task.id}`,
      kind: "task",
      title: task.title,
      status: task.status,
      taskId: task.id,
      ...destination(task.projectId, projects),
    })),
  ];
}
export function dailyLogResults(
  batch: DailyLogBatch,
  projects: Project[],
): CaptureResult[] {
  return batch.rows.map((row) => ({
    key: `line:${row.sourceLine}`,
    kind: row.status === "recorded" ? "update" : "pending",
    title: row.text,
    ...destination(
      row.status === "recorded" ? row.projectId : undefined,
      projects,
    ),
  }));
}
