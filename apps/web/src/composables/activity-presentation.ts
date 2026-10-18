import type {
  Activity,
  Member,
  Project,
  Task,
} from "../../../../packages/domain/types";
import { channelEntries } from "../../../../packages/domain/channels";
import { isCompletionAction, isHistoryRestore } from "./activity-summary";
import { catalogLabel, catalogs } from "./catalogs";
import { t, formatDate } from "../locales";
import { statusLabels } from "../locales/en";

export interface ActivityChange {
  /** A system label for the caller to translate. Values are already formatted. */
  field: string;
  before: string;
  after: string;
}

export interface ActivityPresentation {
  /** Preserve saved actions and translate them only at the point of rendering. */
  label: string;
  tone: "neutral" | "project" | "task" | "completed" | "danger" | "restored";
  subject: string | null;
  changes: ActivityChange[];
  /** User-authored text: do not translate or normalize. */
  reason: string | null;
}

/** Current labels provide context; saved owner/assignee text stays untouched. */
export interface ActivityPresentationContext {
  members?: readonly Pick<Member, "id" | "name" | "email">[];
  projects?: readonly Pick<Project, "id" | "name">[];
  tasks?: readonly Pick<Task, "id" | "title">[];
}

type Snapshot = Project | Task;
type Field = {
  key: string;
  label: string;
  format?: (value: unknown, context: ActivityPresentationContext) => string;
  unordered?: boolean;
  /** Linked identity adds information only if the accompanying text is unchanged. */
  textField?: "assignee" | "owner";
  /** Explain a real identity change even if unavailable labels look identical. */
  changedLabel?: string;
  compareValue?: (value: unknown) => unknown;
};

function isTask(value: Snapshot | null): value is Task {
  return value !== null && "title" in value && "projectId" in value;
}

function isProject(value: Snapshot | null): value is Project {
  return value !== null && "name" in value && "stage" in value;
}

function empty(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function text(value: unknown): string {
  if (empty(value)) return "—";
  if (typeof value === "boolean") return t(value ? "Yes" : "No");
  if (Array.isArray(value)) return value.map(text).join("、");
  return String(value);
}

function date(value: unknown): string {
  return empty(value) ? "—" : formatDate(String(value));
}

function member(value: unknown, context: ActivityPresentationContext): string {
  if (empty(value)) return "—";
  const linked = context.members?.find((item) => item.id === value);
  if (!linked) return t("Member unavailable");
  if (linked.name && linked.email && linked.name !== linked.email)
    return `${linked.name} (${linked.email})`;
  return linked.name || linked.email || t("Member unavailable");
}

function same(before: unknown, after: unknown, unordered = false) {
  const normalize = (value: unknown) =>
    empty(value)
      ? null
      : unordered && Array.isArray(value)
        ? [...value].sort()
        : value;
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
}

const taskFields: Field[] = [
  {
    key: "status",
    label: "Status",
    format: (value) =>
      empty(value)
        ? "—"
        : (statusLabels[value as Task["status"]] ?? text(value)),
  },
  { key: "title", label: "Task title" },
  { key: "assignee", label: "Assignee" },
  {
    key: "assigneeId",
    label: "Linked assignee",
    changedLabel: "Linked assignee changed",
    textField: "assignee",
    format: member,
  },
  {
    key: "projectId",
    label: "Project assignment",
    changedLabel: "Project assignment changed",
    format: (value, context) =>
      empty(value)
        ? "—"
        : (context.projects?.find((item) => item.id === value)?.name ??
          t("Previous project")),
  },
  {
    key: "parentId",
    label: "Parent task",
    changedLabel: "Parent task changed",
    format: (value, context) =>
      empty(value)
        ? "—"
        : (context.tasks?.find((item) => item.id === value)?.title ??
          t("Previous task")),
  },
  { key: "dueDate", label: "Due date", format: date },
  { key: "estimatedDate", label: "Estimated date", format: date },
  { key: "scheduleStart", label: "Schedule start", format: date },
  { key: "scheduleEnd", label: "Schedule end", format: date },
  {
    key: "milestone",
    label: "Milestone",
    compareValue: (value) => value === true,
    format: (value) => t(value === true ? "Yes" : "No"),
  },
  {
    key: "dependencies",
    label: "Predecessor tasks",
    changedLabel: "Predecessor tasks changed",
    compareValue: (value) =>
      Array.isArray(value)
        ? value.map((edge) => JSON.stringify([edge.taskId, edge.type])).sort()
        : [],
    format: (value, context) =>
      Array.isArray(value) && value.length
        ? value
            .map(
              (edge) =>
                context.tasks?.find((task) => task.id === edge.taskId)?.title ??
                t("Previous task"),
            )
            .join("、")
        : "—",
  },
  {
    key: "reminderAt",
    label: "Reminder",
    format: (value) =>
      empty(value)
        ? "—"
        : formatDate(String(value), {
            dateStyle: "medium",
            timeStyle: "short",
          }),
  },
  {
    key: "workDates",
    label: "Work dates",
    unordered: true,
    format: (value) =>
      Array.isArray(value) && value.length ? value.map(date).join("、") : "—",
  },
  { key: "workWeek", label: "Work week", format: date },
  { key: "description", label: "Description" },
];

const projectFields: Field[] = [
  { key: "latestUpdate", label: "Latest reported update" },
  { key: "name", label: "Project name" },
  { key: "shortName", label: "Short name" },
  {
    key: "stage",
    label: "Stage",
    format: (value) =>
      empty(value) ? "—" : catalogLabel("stages", String(value)),
  },
  { key: "owner", label: "Owner" },
  {
    key: "ownerId",
    label: "Linked owner",
    changedLabel: "Linked owner changed",
    textField: "owner",
    format: member,
  },
  {
    key: "participantIds",
    label: "Project participants",
    changedLabel: "Project participants changed",
    unordered: true,
    format: (value, context) =>
      Array.isArray(value) && value.length
        ? value.map((id) => member(id, context)).join("、")
        : "—",
  },
  { key: "client", label: "Client / organization" },
  {
    key: "channelId",
    label: "Channel",
    format: (value) =>
      empty(value)
        ? "—"
        : (channelEntries(catalogs.value).find(
            (channel) => channel.id === value,
          )?.name ?? text(value)),
  },
  {
    key: "categoryIds",
    label: "Categories",
    unordered: true,
    format: (value) =>
      Array.isArray(value) && value.length
        ? value.map((id) => catalogLabel("categories", String(id))).join("、")
        : "—",
  },
  {
    key: "discipline",
    label: "Responsibility",
    format: (value) => (empty(value) ? "—" : t(String(value))),
  },
  { key: "description", label: "Description" },
  { key: "notes", label: "Working notes" },
  { key: "aliases", label: "Aliases", unordered: true },
  { key: "intakeInbox", label: "Intake inbox" },
];

function changesFor(
  event: Activity,
  context: ActivityPresentationContext,
): ActivityChange[] {
  const fields =
    event.kind === "task"
      ? taskFields
      : event.kind === "project"
        ? projectFields
        : [];
  const before = event.before as Record<string, unknown> | null;
  const after = event.after as Record<string, unknown> | null;
  return fields.flatMap((field) => {
    // Older report events have no prior snapshot; they are reports, not
    // evidence that every field on the project was created at that moment.
    if (
      !before &&
      event.action === "Reported an update" &&
      field.key !== "latestUpdate"
    )
      return [];
    // The subject already identifies a created or removed record. Keep this
    // field in real edits so a rename still shows its previous value.
    if ((!before || !after) && (field.key === "name" || field.key === "title"))
      return [];
    const previous = before?.[field.key];
    const next = after?.[field.key];
    if (
      same(
        field.compareValue ? field.compareValue(previous) : previous,
        field.compareValue ? field.compareValue(next) : next,
        field.unordered,
      )
    )
      return [];
    if (
      field.textField &&
      !same(before?.[field.textField], after?.[field.textField])
    )
      return [];
    const format = field.format ?? text;
    const previousText = format(previous, context);
    const nextText = format(next, context);
    return [
      {
        field:
          previousText === nextText && field.changedLabel
            ? field.changedLabel
            : field.label,
        before: previousText,
        after: nextText,
      },
    ];
  });
}

/** Read saved snapshots, never today's record: older history keeps its meaning. */
export function presentActivity(
  event: Activity,
  context: ActivityPresentationContext = {},
): ActivityPresentation {
  const { before, after } = event;
  const subject =
    event.action === "Reordered projects"
      ? null
      : isTask(after)
        ? after.title
        : isTask(before)
          ? before.title
          : isProject(after)
            ? after.name
            : isProject(before)
              ? before.name
              : null;
  const result: ActivityPresentation = {
    label: event.action,
    tone:
      event.kind === "task"
        ? "task"
        : event.kind === "project"
          ? "project"
          : "neutral",
    subject,
    changes: changesFor(event, context),
    reason: null,
  };
  if (isHistoryRestore(event)) {
    result.label = "Previous version restored";
    result.tone = "restored";
  } else if (isTask(before) && isTask(after)) {
    if (!before.voided && after.voided) {
      result.label = "Task voided";
      result.tone = "danger";
      result.reason = after.voided.reason;
    } else if (before.voided && !after.voided) {
      result.label = "Voided task restored";
      result.tone = "restored";
      result.reason = event.source || null;
    } else if (isCompletionAction(event)) {
      result.tone = "completed";
    }
  }
  return result;
}
