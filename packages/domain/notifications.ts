import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { dayKey, type Project, type Snapshot, type Task } from "./types.js";
import { timeZoneInput } from "./time-zone.js";

export const notificationKinds = [
  "task_risk",
  "project_metadata",
  "assignment",
  "task_change",
  "project_update",
  "capture_confirmation",
  "delivery_issue",
] as const;
export const notificationSeverities = [
  "neutral",
  "info",
  "warning",
  "critical",
] as const;
export const notificationRiskTags = [
  "reminder",
  "overdue",
  "coordination",
  "deadline_near",
] as const;
export const notificationDeliveries = [
  "in_app",
  "important",
  "digest",
  "muted",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export type NotificationSeverity = (typeof notificationSeverities)[number];
export type NotificationRiskTag = (typeof notificationRiskTags)[number];
export type NotificationDelivery = (typeof notificationDeliveries)[number];

const identifier = z.string().trim().min(1).max(200);
const instant = z.string().datetime({ offset: true });
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const notificationPreferencesInput = z
  .object({
    version: z.number().int().positive(),
    delivery: z.enum(notificationDeliveries),
    quietStart: clockTime,
    quietEnd: clockTime,
    digestTime: clockTime,
  })
  .strict();
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesInput
>;
export type NotificationPreferencesInput = NotificationPreferences;
export const defaultNotificationPreferences: NotificationPreferences = {
  version: 1,
  delivery: "in_app",
  quietStart: "22:00",
  quietEnd: "08:00",
  digestTime: "09:00",
};

export const notificationCandidateSchema = z
  .object({
    key: identifier,
    kind: z.enum(notificationKinds),
    severity: z.enum(notificationSeverities),
    title: z.string().min(1).max(500),
    body: z.string().max(8000),
    reason: z.string().max(4000),
    reasons: z.array(z.string().min(1).max(1000)).max(20),
    tags: z.array(z.enum(notificationRiskTags)).max(4).optional(),
    projectId: identifier.nullable(),
    taskId: identifier.nullable(),
    taskIds: z.array(identifier).max(500).optional(),
    dueAt: instant.nullable(),
    actionable: z.boolean(),
  })
  .strict();
export type NotificationCandidate = z.infer<typeof notificationCandidateSchema>;
export const notificationItemSchema = notificationCandidateSchema.extend({
  id: identifier,
  createdAt: instant,
  updatedAt: instant,
  readAt: instant.nullable(),
  resolvedAt: instant.nullable(),
  snoozedUntil: instant.nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationActionInput = z
  .object({
    ids: z.array(identifier).min(1).max(500),
    action: z.enum(["read", "unread", "snooze", "unsnooze"]),
    until: instant.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.ids).size !== value.ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["ids"],
        message: "同一条提醒不能重复处理。",
      });
    if (value.action === "snooze" && !value.until)
      ctx.addIssue({
        code: "custom",
        path: ["until"],
        message: "请选择稍后提醒的时间。",
      });
    if (value.action !== "snooze" && value.until)
      ctx.addIssue({
        code: "custom",
        path: ["until"],
        message: "只有稍后提醒可以设置时间。",
      });
  });
export type NotificationActionInput = z.infer<typeof notificationActionInput>;
export const notificationFollowingInput = z
  .object({
    projectIds: z.array(identifier).max(1000),
    mode: z.enum(["replace", "merge"]),
  })
  .strict()
  .refine(
    (value) => new Set(value.projectIds).size === value.projectIds.length,
    { path: ["projectIds"], message: "关注项目不能重复。" },
  );
export type NotificationFollowingInput = z.infer<
  typeof notificationFollowingInput
>;
export const notificationResponseSchema = z
  .object({
    items: z.array(notificationItemSchema),
    unreadCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    followingIds: z.array(identifier),
    preferences: notificationPreferencesInput,
    timeZone: timeZoneInput,
    asOf: instant,
    deliveryStatus: z
      .object({
        configured: z.boolean(),
        bound: z.boolean(),
        reason: z.string().max(2000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export interface NotificationDeriveOptions {
  isAdmin?: boolean;
}

function activeRecipient(snapshot: Snapshot, recipientId: string): boolean {
  if (!recipientId.trim()) return false;
  return (
    snapshot.members === undefined ||
    snapshot.members.some(
      (member) => member.id === recipientId && member.status === "active",
    )
  );
}

function taskRecipient(task: Task, project: Project): string | null {
  // A text assignment is display data, never an account lookup key.
  return task.assigneeId || project.ownerId || null;
}

function deadlineBoundary(date: string, timeZone: string): string {
  return Temporal.PlainDate.from(date)
    .add({ days: 1 })
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();
}

/**
 * Current conditions only: persistence and channel delivery decide whether a
 * condition is newly observed. Replaying imported activity never emits events.
 */
export function deriveTaskNotifications(
  snapshot: Snapshot,
  recipientId: string,
  now: Date,
  _options: NotificationDeriveOptions = {},
): NotificationCandidate[] {
  void _options;
  if (!activeRecipient(snapshot, recipientId)) return [];
  const timeZone = snapshot.settings?.timeZone ?? "UTC";
  const today = dayKey(now, timeZone);
  const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString();
  const timestamp = now.getTime();
  const projects = new Map(
    snapshot.projects.map((project) => [project.id, project]),
  );
  // Use the whole graph: a filtered/voided child must not promote its parent.
  const parents = new Set(
    snapshot.tasks.map((task) => task.parentId).filter(Boolean),
  );
  return snapshot.tasks.flatMap((task) => {
    const project = projects.get(task.projectId);
    if (
      !project ||
      project.intakeInbox ||
      task.voided ||
      task.status === "done" ||
      parents.has(task.id) ||
      taskRecipient(task, project) !== recipientId
    )
      return [];
    const tags: NotificationRiskTag[] = [];
    const reasons: string[] = [];
    const dueInstants: string[] = [];
    if (task.dueDate && task.dueDate < today) {
      tags.push("overdue");
      reasons.push(`截止日期已过（${task.dueDate}）`);
      dueInstants.push(deadlineBoundary(task.dueDate, timeZone));
    } else if (task.dueDate === today || task.dueDate === tomorrow) {
      tags.push("deadline_near");
      reasons.push(
        `${task.dueDate === today ? "今日" : "明日"}截止（${task.dueDate}）`,
      );
      dueInstants.push(deadlineBoundary(task.dueDate, timeZone));
    }
    if (task.status === "blocked") {
      tags.push("coordination");
      reasons.push("需要协调");
    }
    if (task.reminderAt && Date.parse(task.reminderAt) <= timestamp) {
      tags.push("reminder");
      reasons.push("提醒时间已到");
      dueInstants.push(task.reminderAt);
    }
    if (!tags.length) return [];
    const dueAt =
      dueInstants.sort(
        (left, right) => Date.parse(left) - Date.parse(right),
      )[0] ?? null;
    const reason = reasons.join("；");
    return [
      {
        key: `task:${task.id}`,
        kind: "task_risk" as const,
        severity: tags.includes("overdue")
          ? ("critical" as const)
          : ("warning" as const),
        title: task.title,
        body: `${project.name} · ${reason}`,
        reason,
        reasons,
        tags,
        projectId: project.id,
        taskId: task.id,
        dueAt,
        actionable: true,
      },
    ];
  });
}

export function deriveProjectNotifications(
  snapshot: Snapshot,
  recipientId: string,
  _now: Date,
  options: NotificationDeriveOptions = {},
): NotificationCandidate[] {
  void _now;
  if (!activeRecipient(snapshot, recipientId)) return [];
  return snapshot.projects.flatMap((project) => {
    if (project.intakeInbox) return [];
    const related =
      project.ownerId === recipientId ||
      project.participantIds?.includes(recipientId) ||
      snapshot.projectMembers?.some(
        (member) =>
          member.projectId === project.id && member.userId === recipientId,
      ) ||
      (options.isAdmin && !project.ownerId);
    if (!related) return [];
    const missing = [
      !project.owner.trim() || project.owner.trim() === "Unassigned"
        ? "负责人"
        : "",
      project.stage === "unclassified" ? "阶段" : "",
    ].filter(Boolean);
    if (!missing.length) return [];
    const reasons = missing.map((field) => `待补${field}`);
    const reason = reasons.join("、");
    return [
      {
        key: `project:${project.id}:metadata`,
        kind: "project_metadata" as const,
        severity: "neutral" as const,
        title: project.name,
        body: reason,
        reason,
        reasons,
        projectId: project.id,
        taskId: null,
        dueAt: null,
        actionable: true,
      },
    ];
  });
}

export function deriveNotifications(
  snapshot: Snapshot,
  recipientId: string,
  now: Date,
  options: NotificationDeriveOptions = {},
): NotificationCandidate[] {
  return [
    ...deriveTaskNotifications(snapshot, recipientId, now, options),
    ...deriveProjectNotifications(snapshot, recipientId, now, options),
  ];
}

/** Equal start/end disables quiet hours; intervals use the workspace clock. */
export function isNotificationQuietTime(
  now: Date,
  timeZone: string,
  preferences: NotificationPreferences,
): boolean {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
  const { quietStart: start, quietEnd: end } = preferences;
  if (start === end) return false;
  return start < end
    ? local >= start && local < end
    : local >= start || local < end;
}
