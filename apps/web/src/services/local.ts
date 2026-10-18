import {
  planTaskBulkUpdate,
  TaskBulkConflict,
} from "../../../../packages/domain/task-bulk-update";
import {
  answerAssistantQuery,
  assistantSessionInput,
  type AssistantSession,
} from "../../../../packages/domain/assistant";
import { normalizeImportedTaskPlanning } from "../../../../packages/domain/snapshot-schedule";
import {
  normalizeTaskOrder,
  nextTaskSortOrder,
  planTaskMove,
  TaskMoveConflict,
} from "../../../../packages/domain/task-move";
import {
  taskDependencyReplaceInput,
  planTaskDependencies,
  TaskDependencyConflict,
} from "../../../../packages/domain/task-dependencies";
import {
  taskSchedulePatchInput,
  taskScheduleBatchInput,
  planTaskSchedules,
  TaskScheduleConflict,
  type TaskScheduleChange,
} from "../../../../packages/domain/task-schedule-write";
import { retainTaskSchedule } from "../../../../packages/domain/task-schedule";
import type { WecomConfiguration } from "../../../../packages/domain/directory";
import {
  defaultNotificationPreferences,
  deriveNotifications,
  notificationActionInput,
  notificationFollowingInput,
  notificationItemSchema,
  notificationPreferencesInput,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationResponse,
} from "../../../../packages/domain/notifications";
import {
  dailyLogInput,
  planDailyLog,
  planBulkProjectFill,
  type DailyLogBatch,
} from "../../../../packages/domain/daily-log";
import {
  validateMeetingSelection,
  settleMeetingProposal,
  meetingNewProjectFields,
  validateMeetingNewProjectSelection,
  type MeetingApplyOptions,
} from "../../../../packages/domain/meeting-completion";
import type { TaskReview } from "../../../../packages/domain/task-review";
import {
  attributedReportSuggestion,
  matchingReportTask,
  reportProgressKey,
  reportProgressSource,
  reportTaskAssignment,
  reportWorkWeek,
  saveReviewedReportSuggestion,
} from "../../../../packages/domain/report-attribution";
import { channelEntries } from "../../../../packages/domain/channels";
import {
  planTaskLifecycle,
  TaskLifecycleConflict,
} from "../../../../packages/domain/task-lifecycle";
import {
  planTaskFieldCopy,
  TaskFieldCopyConflict,
} from "../../../../packages/domain/task-field-copy";
import {
  suggestedLoginName,
  availableLoginName,
} from "../../../../packages/domain/login-name";
import { loginNameSchema } from "../../../../packages/domain/login-name-schema";
import {
  progressInput,
  progressHistory,
} from "../../../../packages/domain/progress";
import {
  defaultWorkspaceSettings,
  workspaceSettingsInput,
} from "../../../../packages/domain/time-zone";
import {
  defaultCatalogs,
  defaultModelSettings,
  catalogsInput,
  adminUserInput,
  adminUserUpdate,
  modelSettingsInput,
  modelAllowanceInput,
  checkCatalogs,
  checkProjectCatalog,
  importCatalogs,
  validateCatalogReferences,
  type ManagedUser,
  type ModelSettings,
  type ModelLog,
  type AdminAudit,
} from "../../../../packages/domain/admin";
import { createSeed } from "../../../../packages/domain/seed";
import {
  directorySchema,
  emptyDirectory,
} from "../../../../packages/domain/directory";
import {
  checkProjectOrder,
  orderedProjectIds,
  projectOrderInput,
} from "../../../../packages/domain/project-order";
import {
  projectMembers,
  taskMember,
} from "../../../../packages/domain/members";
import {
  queryActivities,
  compareActivities,
} from "../../../../packages/domain/activity-query";
import {
  intakeInput,
  planIntake,
  verifyIntakeUndo,
  intakeProvenance,
  type IntakeBatch,
} from "../../../../packages/domain/intake";
import {
  noteDateInput,
  noteDateCandidates,
  projectInput,
  taskInput,
  snapshotImport,
  validateGraph,
  suggest,
  type Snapshot,
  type Actor,
  type Project,
  type Task,
  type ProjectInput,
  type TaskInput,
  type Proposal,
  type Suggestion,
  type Activity,
} from "../../../../packages/domain/types";
import {
  ApiError,
  type WorkspaceApi,
  type ReviewedSuggestion,
} from "./contracts";
const KEY = "project-manage-demo-v1";
import {
  projectRenameInput,
  planProjectMerge,
  ProjectMergeConflict,
} from "../../../../packages/domain/project-merge";
const actor: Actor = {
  id: "local-demo",
  workspaceId: "local-demo",
  email: "demo@example.test",
  name: "Local demo",
  role: "admin",
};
export function createLocalApi(): WorkspaceApi {
  let state: Snapshot & {
    intakes?: IntakeBatch[];
    dailyLogs?: DailyLogBatch[];
    assistantProposals?: Proposal[];
    administration?: {
      users: ManagedUser[];
      model: ModelSettings;
      allowance?: { maxRequests: number; expiresAt: string };
      logs: ModelLog[];
      audit: AdminAudit[];
    };
  };
  const read = () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      state = {
        ...createSeed(),
        schemaVersion: 3,
        catalogs: structuredClone(defaultCatalogs),
      };
      localStorage.setItem(KEY, JSON.stringify(state));
    } else {
      try {
        const data = JSON.parse(raw);
        const parsed = snapshotImport.parse(data);
        validateGraph(parsed.projects, parsed.tasks);
        if (parsed.schemaVersion >= 2 && !parsed.catalogs)
          throw new Error("Missing catalog");
        validateCatalogReferences(
          parsed.projects,
          parsed.catalogs ?? defaultCatalogs,
        );
        state = {
          ...data,
          ...parsed,
          schemaVersion: 3,
          catalogs: parsed.catalogs ?? structuredClone(defaultCatalogs),
        };
      } catch {
        throw new ApiError(
          "Local demo data is invalid. Export your browser storage before resetting this demo.",
        );
      }
    }
    state.tasks = normalizeTaskOrder(state.tasks);
    state.projectOrder = orderedProjectIds(state.projects, state.projectOrder);
    return structuredClone(state);
  };
  const persist = () => {
    // Creation paths share task objects with audit/intake receipts. Assign the
    // persisted order before serializing so an untouched receipt still matches.
    normalizeTaskOrder(state.tasks).forEach((task, index) => {
      state.tasks[index]!.sortOrder = task.sortOrder;
    });
    state.revision++;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      throw new ApiError(
        "Browser storage is full or unavailable. Export your work and free some space.",
      );
    }
  };
  const record = (
    kind: Activity["kind"],
    before: Project | Task | null,
    after: Project | Task | null,
    source = "Local edit",
    action?: string,
    progressSource?: Activity["progressSource"],
  ) => {
    state.activities.unshift({
      id: crypto.randomUUID(),
      projectId:
        kind === "task"
          ? ((after as Task)?.projectId ?? (before as Task)?.projectId ?? null)
          : (after?.id ?? before?.id ?? null),
      entityId: after?.id ?? before?.id ?? "",
      kind,
      action: action ?? (before ? "Updated " + kind : "Created " + kind),
      actor: actor.name,
      actorId: actor.id,
      createdAt: new Date().toISOString(),
      source,
      progressSource,
      before,
      after,
    });
    const projectId =
      kind === "task"
        ? (after as Task | null)?.projectId
        : kind === "project"
          ? after?.id
          : undefined;
    if (projectId) {
      state.projectMembers ??= [];
      const member = state.projectMembers.find(
        (m) => m.projectId === projectId && m.userId === actor.id,
      );
      const time = new Date().toISOString();
      if (member) member.lastEditedAt = time;
      else
        state.projectMembers.push({
          projectId,
          userId: actor.id,
          name: actor.name,
          department: "",
          position: "",
          joinedAt: time,
          lastEditedAt: time,
        });
    }
  };
  const saveProject = async (
    data: ProjectInput,
    id?: string,
    version?: number,
    source = "Local edit",
  ) => {
    read();
    data = projectInput.parse({
      ...data,
      channelId:
        data.channelId ??
        state.projects.find((p) => p.id === id)?.channelId ??
        "company",
    });
    checkProjectCatalog(
      data,
      state.catalogs ?? defaultCatalogs,
      id ? state.projects.find((p) => p.id === id) : undefined,
    );
    const old = state.projects.find((p) => p.id === id);
    if (id && !old) throw new ApiError("Project not found", 404);
    if (
      source !== "History restore" &&
      data.location === undefined &&
      old?.location !== undefined
    )
      data.location = old.location;
    if (old && old.version !== version)
      throw new ApiError(
        "This project changed in another tab. Review the latest version.",
        409,
        old,
      );
    const p: Project = {
      ...projectMembers(data, administration().users, old),
      reportedAt:
        data.latestUpdate === old?.latestUpdate
          ? old.reportedAt
          : data.latestUpdate.trim()
            ? new Date().toISOString()
            : null,
      reportedBy:
        data.latestUpdate === old?.latestUpdate
          ? old.reportedBy
          : data.latestUpdate.trim()
            ? actor.name
            : null,
      id: id ?? crypto.randomUUID(),
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    state.projects = old
      ? state.projects.map((x) => (x.id === id ? p : x))
      : [p, ...state.projects];
    record(
      "project",
      old ?? null,
      p,
      source,
      source === "History restore" ? "Restored previous version" : undefined,
    );
    persist();
    return p;
  };
  function applyTaskSchedules(changes: TaskScheduleChange[], source: string) {
    let planned;
    try {
      planned = planTaskSchedules(state.tasks, changes);
    } catch (reason) {
      throw new ApiError(
        (reason as Error).message,
        reason instanceof TaskScheduleConflict ? 409 : 400,
        reason instanceof TaskScheduleConflict ? reason.current : undefined,
      );
    }
    const updates = new Map(
      planned.map((change) => [change.after.id, change.after]),
    );
    const candidate = state.tasks.map((task) => updates.get(task.id) ?? task);
    validateGraph(state.projects, candidate);
    state.tasks = candidate;
    for (const { before, after } of planned)
      record("task", before, after, source, "Updated task schedule");
    if (planned.length) persist();
    const confirmed = new Map(state.tasks.map((task) => [task.id, task]));
    return structuredClone(changes.map((change) => confirmed.get(change.id)!));
  }
  const saveTask = async (
    data: TaskInput,
    id?: string,
    version?: number,
    source = "Local edit",
  ) => {
    read();
    taskInput.parse(data);
    const old = state.tasks.find((t) => t.id === id);
    if (id && !old) throw new ApiError("Task not found", 404);
    if (old?.voided) throw new ApiError("任务已作废，请先恢复后再编辑。");
    if (old && old.version !== version)
      throw new ApiError("This task changed in another tab.", 409, old);
    if (
      old &&
      state.tasks.some((x) => x.parentId === old.id) &&
      old.status !== data.status
    )
      throw new ApiError("Update the subtasks individually");
    if (
      old &&
      data.projectId !== old.projectId &&
      (old.parentId ||
        data.parentId ||
        state.tasks.some((x) => x.parentId === old.id))
    )
      throw new ApiError("Only standalone tasks can change project assignment");
    const t: Task = {
      ...retainTaskSchedule(taskMember(data, administration().users, old), old),
      sortOrder:
        old?.projectId === data.projectId && old.parentId === data.parentId
          ? old.sortOrder
          : nextTaskSortOrder(state.tasks, data.projectId, data.parentId),
      id: id ?? crypto.randomUUID(),
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const candidateTasks = old
      ? state.tasks.map((x) => (x.id === id ? t : x))
      : [...state.tasks, t];
    validateGraph(state.projects, candidateTasks);
    state.tasks = candidateTasks;
    record(
      "task",
      old ?? null,
      t,
      source,
      source === "History restore" ? "Restored previous version" : undefined,
    );
    persist();
    return t;
  };
  function loginName(
    name: string,
    requested: string | undefined,
    exceptId = "",
  ) {
    const taken = (value: string) =>
      state.administration?.users.some(
        (u) => u.id !== exceptId && u.username?.toLowerCase() === value,
      ) ?? false;
    if (requested?.trim()) {
      const value = loginNameSchema.parse(requested);
      if (taken(value))
        throw new ApiError("This login name is already in use", 409);
      return value;
    }
    return availableLoginName(suggestedLoginName(name), taken);
  }
  function administration() {
    if (!state.administration)
      state.administration = {
        users: [
          {
            id: actor.id,
            name: actor.name,
            email: actor.email,
            role: "admin",
            status: "active",
            version: 1,
            activationRequired: false,
          },
          {
            id: "demo-member",
            name: "Jamie Chen",
            email: "jamie@example.test",
            role: "member",
            status: "active",
            version: 1,
            activationRequired: false,
          },
        ],
        model: { ...defaultModelSettings },
        logs: [
          {
            id: "simulation-example",
            createdAt: new Date().toISOString(),
            actor: "Local demo",
            provider: "qwen",
            model: "qwen3.6-35b-a3b",
            mode: "simulated",
            status: "succeeded",
            durationMs: 420,
            inputTokens: 180,
            outputTokens: 64,
            cost: null,
            errorCode: null,
            attempts: 1,
          },
        ],
        audit: [],
      };
    for (const user of state.administration.users)
      if (!user.username)
        user.username = loginName(user.name, undefined, user.id);
    return state.administration;
  }
  function auditAdmin(action: string, target: string) {
    administration().audit.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actor: actor.name,
      action,
      target,
    });
  }
  function historyPage(
    query: import("../../../../packages/domain/activity-query").ActivityQuery,
    exportAll = false,
  ) {
    const timeZone = (state.settings ?? defaultWorkspaceSettings).timeZone;
    if (query.timeZone && query.timeZone !== timeZone)
      throw new ApiError(
        "Workspace time zone changed. Refresh history before continuing.",
        409,
      );
    const through =
      query.cursor?.through ??
      query.checkpoint?.through ??
      state.activities.length;
    const events = through
      ? state.activities.slice(-through).sort(compareActivities)
      : [];
    return queryActivities(
      events,
      { ...query, timeZone },
      through,
      new Date(),
      exportAll,
    );
  }
  function modelState() {
    return {
      settings: structuredClone(administration().model),
      credentialAvailable: false,
      credentialEditable: false,
      allowanceEditable: true,
      runtimeEnabled: false,
      approvedRegion: null,
      approvedModel: null,
      maxRequests: administration().allowance?.maxRequests ?? null,
      usedAttempts: 0,
      remainingAttempts: administration().allowance?.maxRequests ?? 0,
      expiresAt: administration().allowance?.expiresAt ?? null,
    };
  }
  const notificationKey = `${KEY}-notifications:${actor.id}`;
  function notificationState() {
    const raw = localStorage.getItem(notificationKey);
    if (!raw)
      return {
        items: [] as NotificationItem[],
        preferences: { ...defaultNotificationPreferences },
        followingIds: [] as string[],
      };
    try {
      const data = JSON.parse(raw);
      return {
        items: notificationItemSchema.array().parse(data.items),
        preferences: notificationPreferencesInput.parse(data.preferences),
        followingIds: notificationFollowingInput.parse({
          projectIds: data.followingIds,
          mode: "replace",
        }).projectIds,
      };
    } catch {
      throw new ApiError(
        "本地提醒数据无法读取，请先导出浏览器数据后重试。",
        400,
      );
    }
  }
  function persistNotifications(value: ReturnType<typeof notificationState>) {
    try {
      localStorage.setItem(notificationKey, JSON.stringify(value));
    } catch {
      throw new ApiError("提醒未保存，浏览器存储不可用或空间不足。", 503);
    }
  }
  function localNotifications(): NotificationResponse {
    const snapshot = read();
    const value = notificationState();
    const now = new Date();
    const asOf = now.toISOString();
    const current = deriveNotifications(snapshot, actor.id, now, {
      isAdmin: true,
    });
    const candidates = new Map(current.map((item) => [item.key, item]));
    const existing = new Map(value.items.map((item) => [item.key, item]));
    for (const item of value.items) {
      if (!candidates.has(item.key) && !item.resolvedAt) {
        item.resolvedAt = asOf;
        item.updatedAt = asOf;
        item.snoozedUntil = null;
      }
    }
    for (const candidate of current) {
      const old = existing.get(candidate.key);
      if (old) {
        const changed =
          old.reason !== candidate.reason || old.title !== candidate.title;
        const reopening = !!old.resolvedAt;
        Object.assign(old, candidate, {
          resolvedAt: null,
          ...(changed || reopening ? { updatedAt: asOf } : {}),
          ...(reopening ? { readAt: null, snoozedUntil: null } : {}),
        });
      } else {
        value.items.push({
          ...candidate,
          id: crypto.randomUUID(),
          createdAt: asOf,
          updatedAt: asOf,
          readAt: null,
          resolvedAt: null,
          snoozedUntil: null,
        });
      }
    }
    value.followingIds = value.followingIds.filter((id) =>
      snapshot.projects.some((project) => project.id === id),
    );
    persistNotifications(value);
    const items = [...value.items].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    return {
      items,
      followingIds: value.followingIds,
      preferences: value.preferences,
      unreadCount: items.filter(
        (item) =>
          !item.resolvedAt &&
          !item.readAt &&
          (!item.snoozedUntil ||
            Date.parse(item.snoozedUntil) <= now.getTime()),
      ).length,
      pendingCount: items.filter((item) => !item.resolvedAt && item.actionable)
        .length,
      timeZone: snapshot.settings?.timeZone ?? "UTC",
      asOf,
      deliveryStatus: {
        configured: false,
        bound: false,
        reason: "本地演示仅保存站内提醒。",
      },
    };
  }
  return {
    async speechCapabilities() {
      return {
        enabled: false,
        model: "qwen3-asr-flash",
        maxSeconds: 120,
        reason: "语音识别需要团队工作区；演示模式不会发送录音。",
      };
    },
    async transcribeSpeech() {
      throw new ApiError("云端语音识别需要团队工作区。", 503);
    },
    async assistantSession() {
      read();
      const value = localStorage.getItem(KEY + ":assistant");
      const session = value
        ? (JSON.parse(value) as AssistantSession)
        : { version: 0, updatedAt: null, state: {} };
      const proposal = session.state.proposal as Proposal | undefined;
      const authoritative = state.assistantProposals?.find(
        (p) => p.id === proposal?.id,
      );
      if (authoritative)
        session.state.proposal = structuredClone(authoritative);
      return session;
    },
    async saveAssistantSession(input) {
      const parsed = assistantSessionInput.parse(input);
      const current = await this.assistantSession();
      if (current.version !== parsed.version)
        throw new ApiError("另一端已更新对话。", 409);
      const result = {
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        state: parsed.state,
      };
      localStorage.setItem(KEY + ":assistant", JSON.stringify(result));
      return result;
    },
    async queryAssistant(input) {
      return answerAssistantQuery(input, await this.snapshot(), actor);
    },
    async notifications() {
      return localNotifications();
    },
    async notificationAction(input) {
      localNotifications();
      const parsed = notificationActionInput.parse(input);
      const value = notificationState();
      const now = new Date();
      if (
        parsed.action === "snooze" &&
        (Date.parse(parsed.until!) <= now.getTime() ||
          Date.parse(parsed.until!) > now.getTime() + 30 * 86400000)
      )
        throw new ApiError("稍后提醒时间应在未来30天内。", 400);
      const selected = new Set(parsed.ids);
      if (parsed.ids.some((id) => !value.items.some((item) => item.id === id)))
        throw new ApiError("提醒已变化，请刷新后重试。", 404);
      if (
        parsed.action === "snooze" &&
        value.items.some((item) => selected.has(item.id) && item.resolvedAt)
      )
        throw new ApiError("这条事项已处理，无需再次提醒。", 409);
      for (const item of value.items) {
        if (!selected.has(item.id)) continue;
        if (parsed.action === "read") {
          item.readAt = now.toISOString();
          if (!item.actionable) item.resolvedAt = now.toISOString();
        }
        if (parsed.action === "unread") {
          item.readAt = null;
          if (!item.actionable) item.resolvedAt = null;
        }
        if (parsed.action === "snooze") {
          item.snoozedUntil = new Date(parsed.until!).toISOString();
          item.readAt = null;
        }
        if (parsed.action === "unsnooze") item.snoozedUntil = null;
        item.updatedAt = now.toISOString();
      }
      persistNotifications(value);
      return localNotifications();
    },
    async saveNotificationPreferences(input: NotificationPreferences) {
      localNotifications();
      const parsed = notificationPreferencesInput.parse(input);
      const value = notificationState();
      if (value.preferences.version !== parsed.version)
        throw new ApiError("提醒偏好已在其他页面更新，请刷新后重试。", 409);
      value.preferences = { ...parsed, version: parsed.version + 1 };
      persistNotifications(value);
      return localNotifications();
    },
    async saveNotificationFollowing(input) {
      localNotifications();
      const parsed = notificationFollowingInput.parse(input);
      if (
        parsed.projectIds.some(
          (id) => !state.projects.some((project) => project.id === id),
        )
      )
        throw new ApiError("关注项目已变化，请刷新后重试。", 400);
      const value = notificationState();
      value.followingIds =
        parsed.mode === "merge"
          ? [...new Set([...value.followingIds, ...parsed.projectIds])]
          : parsed.projectIds;
      persistNotifications(value);
      return localNotifications();
    },
    async openNotification(id) {
      const result = localNotifications();
      const item = result.items.find((item) => item.id === id);
      if (!item) throw new ApiError("提醒不存在或已不可访问。", 404);
      if (item.taskId) {
        const task = state.tasks.find((task) => task.id === item.taskId);
        if (task)
          return {
            path: `/projects/${encodeURIComponent(task.projectId)}?task=${encodeURIComponent(task.id)}`,
          };
      }
      if (
        item.projectId &&
        state.projects.some((project) => project.id === item.projectId)
      )
        return {
          path: `/projects/${encodeURIComponent(item.projectId)}${item.kind === "project_update" ? "#progress-history" : ""}`,
        };
      throw new ApiError("原事项已不可访问，请查看活动记录。", 404);
    },
    async taskLifecycle(id, input) {
      read();
      let changes;
      try {
        changes = planTaskLifecycle(
          state.tasks,
          id,
          input,
          state.revision,
          actor,
          crypto.randomUUID(),
        );
      } catch (e) {
        throw new ApiError(
          (e as Error).message,
          e instanceof TaskLifecycleConflict ? 409 : 400,
        );
      }
      const replacements = new Map(changes.map((c) => [c.after.id, c.after]));
      const candidateTasks = state.tasks.map(
        (t) => replacements.get(t.id) ?? t,
      );
      validateGraph(state.projects, candidateTasks);
      state.tasks = candidateTasks;
      for (const { before, after } of changes)
        record(
          "task",
          before,
          after,
          input.reason || "恢复误作废的任务",
          input.action === "void" ? "作废任务" : "恢复已作废任务",
        );
      persist();
      return structuredClone(changes.map((c) => c.after));
    },
    async moveTask(id, input) {
      read();
      if (!state.tasks.some((task) => task.id === id))
        throw new ApiError("Task not found", 404);
      let changes;
      try {
        changes = planTaskMove(state.projects, state.tasks, id, input);
      } catch (error) {
        throw new ApiError(
          (error as Error).message,
          error instanceof TaskMoveConflict ? 409 : 400,
          error instanceof TaskMoveConflict ? error.current : undefined,
        );
      }
      const updates = new Map(changes.map(({ after }) => [after.id, after]));
      state.tasks = state.tasks.map((task) => updates.get(task.id) ?? task);
      for (const { before, after } of changes)
        record("task", before, after, "Task placement", "Moved task");
      if (changes.length) persist();
      return structuredClone(changes.map(({ after }) => after));
    },
    async copyTaskField(input) {
      read();
      let changes;
      try {
        changes = planTaskFieldCopy(state.tasks, input);
        changes = changes.map(({ before, after }) => ({
          before,
          after: {
            ...after,
            ...taskMember(after, administration().users, before),
          },
        }));
      } catch (e) {
        throw new ApiError(
          (e as Error).message,
          e instanceof TaskFieldCopyConflict ? 409 : 400,
        );
      }
      const updates = new Map(
        changes.map((change) => [change.after.id, change.after]),
      );
      state.tasks = state.tasks.map((task) => updates.get(task.id) ?? task);
      for (const { before, after } of changes)
        record(
          "task",
          before,
          after,
          "Task field copy",
          input.field === "assignee"
            ? "Copied task assignee"
            : "Copied task due date",
        );
      persist();
      return structuredClone(changes.map((change) => change.after));
    },
    async aiCapabilities() {
      return {
        enabled: false,
        provider: "rules",
        model: null,
        region: null,
        connectionVerified: false,
        remainingAttempts: 0,
      };
    },
    async progressMaterial() {
      throw new ApiError(
        "File processing requires the server workspace. Your file was not sent.",
        503,
      );
    },
    async captureMaterial() {
      throw new ApiError(
        "File processing requires the server workspace. Your file was not sent.",
        503,
      );
    },
    async extractCaptureMaterial() {
      throw new ApiError("附件识别需要团队工作区。", 503);
    },
    async classifyCaptureReferences() {
      throw new ApiError("附件归档需要团队工作区。", 503);
    },
    async archiveCaptureReferences() {
      throw new ApiError("附件归档需要团队工作区。", 503);
    },
    async analyzeCapture() {
      throw new ApiError(
        "Qwen is unavailable in the browser-only demo. No notes were sent.",
        503,
      );
    },
    async progressMaterials() {
      return [];
    },
    async projectFiles() {
      return [];
    },
    async uploadProjectFile() {
      throw new ApiError(
        "附件上传需要服务端工作区，本地演示不会上传文件。",
        503,
      );
    },
    async projectFileContent() {
      throw new ApiError("附件预览需要服务端工作区。", 503);
    },
    async analyzeProgress() {
      throw new ApiError(
        "Qwen is unavailable in the browser-only demo. No notes were sent.",
        503,
      );
    },
    async proposeQwen() {
      throw new ApiError(
        "Qwen is unavailable in the browser-only demo. No notes were sent.",
        503,
      );
    },
    mode: "local",
    async session() {
      return { actor };
    },
    async login() {
      return { actor };
    },
    async logout() {},
    async snapshot() {
      const snapshot = read();
      return {
        ...snapshot,
        settings: state.settings ?? { ...defaultWorkspaceSettings },
        members: administration().users.map(({ id, name, email, status }) => ({
          id,
          name,
          email,
          status,
        })),
      };
    },
    async saveWorkspaceSettings(input) {
      read();
      const old = state.settings ?? defaultWorkspaceSettings;
      if (!input.confirmed)
        throw new ApiError("Confirm changing the workspace time zone");
      const parsed = workspaceSettingsInput.parse({
        timeZone: input.timeZone,
        version: input.version,
      });
      if (old.version !== parsed.version)
        throw new ApiError(
          "Workspace settings changed. Reload the current settings before saving.",
          409,
        );
      state.settings = { timeZone: parsed.timeZone, version: old.version + 1 };
      auditAdmin(
        `Changed workspace time zone: ${old.timeZone} → ${parsed.timeZone}`,
        actor.workspaceId,
      );
      persist();
      return structuredClone(state.settings);
    },
    async activityPage(query) {
      read();
      return historyPage(query);
    },
    async exportActivity(query) {
      read();
      return historyPage(query, true);
    },
    async activity(id) {
      read();
      const event = state.activities.find((a) => a.id === id);
      if (!event) throw new ApiError("History record not found", 404);
      return structuredClone(event);
    },
    async analyzeProjectLocation(id, version) {
      read();
      const project = state.projects.find((item) => item.id === id);
      if (!project) throw new ApiError("Project not found", 404);
      if (project.version !== version)
        throw new ApiError("项目已更新，请刷新后重试。", 409, project);
      const { inferProjectLocation } =
        await import("../../../../packages/domain/project-location");
      return {
        ...inferProjectLocation(project),
        provider: "rules",
        model: null,
      };
    },
    saveProject,
    async progressHistory(id) {
      read();
      const project = state.projects.find((p) => p.id === id);
      if (!project) throw new ApiError("Project not found", 404);
      return progressHistory(project, [...state.activities].reverse());
    },
    async addProgress(id, raw) {
      read();
      const input = progressInput.parse(raw),
        old = state.projects.find((p) => p.id === id);
      if (!old) throw new ApiError("Project not found", 404);
      if (old.version !== input.version)
        throw new ApiError(
          "This project changed in another tab. Review the latest version.",
          409,
          old,
        );
      if (input.mode === "correct" && !old.latestUpdate.trim())
        throw new ApiError(
          "There is no previous progress entry to correct.",
          400,
        );
      const now = new Date().toISOString();
      const project = {
        ...old,
        latestUpdate: input.text,
        reportedAt: input.mode === "new" ? now : old.reportedAt,
        reportedBy: input.mode === "new" ? actor.name : old.reportedBy,
        updatedAt: now,
        version: old.version + 1,
      };
      state.projects = state.projects.map((p) => (p.id === id ? project : p));
      record(
        "project",
        old,
        project,
        input.mode === "new" ? "Progress log" : "Progress correction",
        input.mode === "new"
          ? "Added progress log"
          : "Corrected latest progress log",
        input.originalSource,
      );
      persist();
      return structuredClone(project);
    },
    async renameProject(id, name, version, shortName) {
      read();
      const input = projectRenameInput.parse({ name, version, shortName });
      const old = state.projects.find((p) => p.id === id);
      if (!old) throw new ApiError("Project not found", 404);
      if (old.version !== input.version)
        throw new ApiError(
          "This project changed in another tab. Review the latest version.",
          409,
          old,
        );
      const project = {
        ...old,
        name: input.name,
        shortName: input.shortName ?? old.shortName,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      state.projects = state.projects.map((p) => (p.id === id ? project : p));
      record("project", old, project, "Local edit", "Renamed project");
      persist();
      return project;
    },
    async mergeProjects(input) {
      read();
      let plan;
      try {
        plan = planProjectMerge(state, input);
      } catch (e) {
        if (e instanceof ProjectMergeConflict)
          throw new ApiError(e.message, 409);
        throw e;
      }
      const before = structuredClone(state);
      try {
        const sourceIds = new Set(plan.sources.map((p) => p.id));
        state.projects = state.projects
          .filter((p) => !sourceIds.has(p.id))
          .map((p) => (p.id === plan.project.id ? plan.project : p));
        const changed = new Map(
          plan.movedTasks.map(({ after }) => [after.id, after]),
        );
        state.tasks = state.tasks.map((t) => changed.get(t.id) ?? t);
        const members = state.projectMembers ?? [];
        state.projectMembers = members.filter(
          (m) => !sourceIds.has(m.projectId),
        );
        for (const member of members.filter((m) =>
          sourceIds.has(m.projectId),
        )) {
          const existing = state.projectMembers.find(
            (m) =>
              m.projectId === plan.project.id && m.userId === member.userId,
          );
          if (existing) {
            existing.joinedAt = [existing.joinedAt, member.joinedAt].sort()[0]!;
            existing.lastEditedAt = [existing.lastEditedAt, member.lastEditedAt]
              .sort()
              .at(-1)!;
          } else
            state.projectMembers.push({
              ...member,
              projectId: plan.project.id,
            });
        }
        for (const { before, after } of plan.movedTasks)
          record(
            "task",
            before,
            after,
            "Project merge",
            "Moved task to merged project",
          );
        for (const p of plan.sources)
          record("project", p, null, "Project merge", "Merged source project");
        state.activities = state.activities.map((a) =>
          a.projectId && sourceIds.has(a.projectId)
            ? {
                ...a,
                originalProjectId: a.originalProjectId ?? a.projectId,
                projectId: plan.project.id,
              }
            : a,
        );
        record(
          "project",
          plan.target,
          plan.project,
          "Project merge",
          "Merged projects",
        );
        persist();
      } catch (e) {
        state = before;
        throw e;
      }
      return plan.project;
    },
    async companyDirectory() {
      read();
      return structuredClone(state.directory ?? emptyDirectory());
    },
    async saveCompanyDirectory(input) {
      read();
      const parsed = directorySchema.parse(input);
      if (parsed.version !== (state.directory?.version ?? 1))
        throw new ApiError(
          "Company directory changed. Reload before saving.",
          409,
        );
      state.directory = {
        ...parsed,
        version: parsed.version + 1,
        lastSyncedAt: null,
      };
      persist();
      return structuredClone(state.directory);
    },
    async directoryAccounts() {
      read();
      return structuredClone(
        administration().users.map(({ id, name, email, username, status }) => ({
          id,
          name,
          email,
          username,
          status,
        })),
      );
    },
    async wecomConfiguration(): Promise<WecomConfiguration> {
      return {
        version: 0,
        corpId: "",
        secretConfigured: false,
        source: "local",
      };
    },
    async saveWecomConfiguration() {
      throw new ApiError("请在服务器工作区保存企业微信配置。", 503);
    },
    async wecomSyncState() {
      return { configured: false, lastSyncedAt: null, mode: "local" };
    },
    async syncWecom() {
      throw new ApiError(
        "Enterprise directory sync is not available in the browser demo.",
        503,
      );
    },
    async saveProjectOrder(raw) {
      read();
      const input = projectOrderInput.parse(raw);
      if (input.revision !== state.revision)
        throw new ApiError(
          "Workspace changed. Refresh the project order and try again.",
          409,
        );
      checkProjectOrder(state, input.projectIds);
      const before = state.projectOrder;
      state.projectOrder = input.projectIds;
      record(
        "project",
        null,
        null,
        `Project order\nBefore: ${JSON.stringify(before)}\nAfter: ${JSON.stringify(input.projectIds)}`,
        "Reordered projects",
      );
      persist();
      return [...input.projectIds];
    },
    async reviewTask(): Promise<TaskReview> {
      throw new ApiError("AI review is unavailable in local demo mode.");
    },
    saveTask,
    async saveTaskDependencies(id, raw) {
      read();
      const input = taskDependencyReplaceInput.parse(raw);
      let change;
      try {
        change = planTaskDependencies(state.tasks, id, input);
      } catch (reason) {
        throw new ApiError(
          (reason as Error).message,
          reason instanceof TaskDependencyConflict ? 409 : 400,
          reason instanceof TaskDependencyConflict ? reason.current : undefined,
        );
      }
      if (!change)
        return structuredClone(state.tasks.find((task) => task.id === id)!);
      const candidate = state.tasks.map((task) =>
        task.id === id ? change.after : task,
      );
      validateGraph(state.projects, candidate);
      state.tasks = candidate;
      record(
        "task",
        change.before,
        change.after,
        "Dependency edit",
        "Updated task dependencies",
      );
      persist();
      return structuredClone(change.after);
    },
    async saveTaskSchedule(id, raw) {
      read();
      const input = taskSchedulePatchInput.parse(raw);
      const current = state.tasks.find((task) => task.id === id);
      if (!current) throw new ApiError("Task not found", 404);
      return (
        applyTaskSchedules([{ id, ...input }], "Schedule edit")[0] ??
        structuredClone(current)
      );
    },
    async saveTaskScheduleBatch(raw) {
      read();
      const input = taskScheduleBatchInput.parse(raw);
      if (state.revision !== input.revision)
        throw new ApiError("Workspace changed. Review again.", 409);
      return applyTaskSchedules(
        input.changes,
        `Schedule batch ${crypto.randomUUID()}`,
      );
    },
    async bulkUpdateTasks(raw) {
      read();
      let result;
      try {
        result = planTaskBulkUpdate(state.tasks, administration().users, raw);
      } catch (reason) {
        throw new ApiError(
          (reason as Error).message,
          reason instanceof TaskBulkConflict ? 409 : 400,
          undefined,
          undefined,
          undefined,
          reason instanceof TaskBulkConflict ? reason.conflicts : undefined,
        );
      }
      const updates = new Map(
        result.changes.map((change) => [change.after.id, change.after]),
      );
      const candidate = state.tasks.map((task) => updates.get(task.id) ?? task);
      validateGraph(state.projects, candidate);
      state.tasks = candidate;
      const source = `Task bulk ${crypto.randomUUID()} · ${result.field}`;
      for (const { before, after } of result.changes)
        record("task", before, after, source, "Bulk updated task");
      if (result.changes.length) persist();
      return structuredClone(result.confirmed);
    },
    async confirmNoteDate(projectId, data) {
      read();
      const input = noteDateInput.parse(data);
      const p = state.projects.find((p) => p.id === projectId);
      const old = state.tasks.find((t) => t.id === input.taskId);
      if (!p || !old || old.projectId !== p.id)
        throw new ApiError("Choose a task in this project");
      if (
        p.version !== input.projectVersion ||
        old.version !== input.taskVersion
      )
        throw new ApiError("Notes or task changed. Review again.", 409);
      const candidate = noteDateCandidates(p.notes).find(
        (n) => n.sourceLine === input.sourceLine,
      );
      if (!candidate)
        throw new ApiError("Date source no longer matches saved notes");
      if (
        old.dueDate &&
        old.dueDate !== input.dueDate &&
        !input.overwriteConfirmed
      )
        throw new ApiError("Confirm replacing the existing due date");
      const next = {
        ...old,
        dueDate: input.dueDate,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      state.tasks = state.tasks.map((t) => (t.id === old.id ? next : t));
      record(
        "task",
        old,
        next,
        `Project notes ${p.id} v${p.version}, line ${candidate.sourceLine}: ${candidate.context}`,
      );
      persist();
      return next;
    },
    async addTasks(tasks) {
      read();
      const result = tasks.map((data) => ({
        ...taskMember(taskInput.parse(data), administration().users),
        id: crypto.randomUUID(),
        version: 1,
        updatedAt: new Date().toISOString(),
      }));
      const candidateTasks = [...state.tasks, ...result];
      validateGraph(state.projects, candidateTasks);
      state.tasks = candidateTasks;
      result.forEach((t) => record("task", null, t, "Text / TSV paste"));
      persist();
      return result;
    },
    async exportData() {
      const result = read();
      return {
        ...result,
        settings: state.settings ?? { ...defaultWorkspaceSettings },
      };
    },
    async importData(data, revision) {
      read();
      if (state.revision !== revision)
        throw new ApiError("Workspace changed. Review again.", 409);
      const parsed = normalizeImportedTaskPlanning(snapshotImport.parse(data));
      parsed.projects = parsed.projects.map((p) =>
        projectMembers(
          p,
          administration().users,
          state.projects.find((old) => old.id === p.id),
        ),
      );
      parsed.tasks = parsed.tasks.map((t) =>
        taskMember(
          t,
          administration().users,
          state.tasks.find((old) => old.id === t.id),
        ),
      );
      validateGraph(parsed.projects, parsed.tasks);
      const catalogs = importCatalogs(
        parsed,
        state.catalogs ?? defaultCatalogs,
        true,
      );
      state = {
        ...parsed,
        settings: state.settings ?? { ...defaultWorkspaceSettings },
        schemaVersion: 3,
        catalogs,
        revision: state.revision,
        activities: state.activities,
        administration: state.administration,
        intakes: state.intakes,
        directory: state.directory,
      };
      persist();
      return read();
    },
    async propose(source, originalSource) {
      read();
      const p: Proposal = {
        id: crypto.randomUUID(),
        source,
        ...(originalSource ? { originalSource } : {}),
        sourceVersion: 1,
        status: "draft",
        createdAt: new Date().toISOString(),
        suggestions: suggest(source, state.projects),
      };
      state.assistantProposals = [...(state.assistantProposals ?? []), p];
      persist();
      return structuredClone(p);
    },
    async applyProposal(
      proposal,
      suggestions: ReviewedSuggestion[],
      options: MeetingApplyOptions = {},
    ) {
      read();
      const original = state.assistantProposals?.find(
        (p) => p.id === proposal.id,
      );
      if (!original || original.status === "applied")
        throw new ApiError("Proposal is missing or already applied", 409);
      if (!options.partial && options.skippedIds?.length)
        throw new ApiError("Skipping requires partial completion");
      try {
        validateMeetingSelection(
          original,
          suggestions.map((s) => s.id),
          options.skippedIds ?? [],
        );
      } catch (e) {
        throw new ApiError((e as Error).message, 409);
      }
      const copy = structuredClone(state);
      const appliedResults: NonNullable<Proposal["appliedResults"]> = [];
      const createdProjectIds: string[] = [];
      const updates = new Map<
        string,
        {
          before: Project;
          titles: string[];
          sources: string[];
          sourceTexts: string[];
          attribution: Suggestion;
        }
      >();
      const timeZone = (state.settings ?? defaultWorkspaceSettings).timeZone;
      try {
        suggestions = suggestions.map((item) => ({ ...item }));
        if (options.newProject) {
          if (!options.partial)
            throw new ApiError("新建项目需要明确确认对应的会议事项。");
          validateMeetingNewProjectSelection(options.newProject, suggestions);
          const fields = meetingNewProjectFields(
            options.newProject,
            state.projects,
            channelEntries(state.catalogs ?? defaultCatalogs),
            state.catalogs ?? defaultCatalogs,
          );
          const created: Project = {
            ...fields,
            id: crypto.randomUUID(),
            version: 1,
            updatedAt: new Date().toISOString(),
            reportedAt: null,
            reportedBy: null,
          };
          state.projects.push(created);
          createdProjectIds.push(created.id);
          const source = original.suggestions.find(
            (item) => item.id === options.newProject!.suggestionId,
          )!;
          record(
            "project",
            null,
            created,
            `Meeting source ${original.id} v1, line ${source.sourceLine}: ${source.sourceText}`,
            "Created project from meeting",
          );
          for (const suggestion of suggestions)
            suggestion.selectedProjectId = created.id;
        }
        for (const s of suggestions) {
          const found = original.suggestions.find((x) => x.id === s.id);
          if (!found || !s.confirmed)
            throw new ApiError("Confirm every selected suggestion");
          const source = attributedReportSuggestion(found, original, timeZone);
          const p = state.projects.find((x) => x.id === s.selectedProjectId);
          if (!p) throw new ApiError("Choose a project");
          if (s.action === "update") {
            if (
              options.updateMode !== "append" &&
              (!s.overwriteConfirmed || p.version !== s.projectVersion)
            )
              throw new ApiError(
                "Review and confirm the latest update",
                409,
                p,
              );
            const groupKey = reportProgressKey(p.id, source);
            const group = updates.get(groupKey) ?? {
              before: p,
              titles: [],
              sources: [],
              sourceTexts: [],
              attribution: source,
            };
            group.titles.push(s.title);
            group.sources.push(
              `${source.dailyReport ? "Daily report" : "Meeting source"} ${original.id} v1, line ${source.sourceLine}: ${source.sourceText}`,
            );
            group.sourceTexts.push(source.sourceText);
            updates.set(groupKey, group);
            appliedResults.push({ suggestionId: s.id, projectId: p.id });
          } else {
            const assignment = reportTaskAssignment(
              source,
              state.members ?? [],
            );
            const existing = matchingReportTask(
              source,
              state.tasks,
              p.id,
              s.title,
              assignment,
            );
            if (existing) {
              appliedResults.push({
                suggestionId: s.id,
                projectId: p.id,
                taskId: existing.id,
                taskDisposition: "linked",
              });
              continue;
            }
            const t: Task = {
              ...taskInput.parse({
                projectId: p.id,
                parentId: null,
                title: s.title,
                description: source.sourceText,
                status: s.status,
                ...assignment,
                dueDate: null,
                workWeek: reportWorkWeek(source, s.title),
                workDates: [],
              }),
              id: crypto.randomUUID(),
              version: 1,
              updatedAt: new Date().toISOString(),
            };
            state.tasks.push(t);
            record("task", null, t, source.sourceText);
            appliedResults.push({
              suggestionId: s.id,
              projectId: p.id,
              taskId: t.id,
              ...(source.dailyReport
                ? { taskDisposition: "created" as const }
                : {}),
            });
          }
        }
        for (const group of updates.values()) {
          const before = state.projects.find((p) => p.id === group.before.id)!;
          const next = {
            ...before,
            latestUpdate: group.titles.join("\n"),
            version: before.version + 1,
            updatedAt: new Date().toISOString(),
            reportedAt: new Date().toISOString(),
            reportedBy: group.attribution.reporter || actor.name,
          };
          projectInput.strip().parse(next);
          state.projects = state.projects.map((p) =>
            p.id === next.id ? next : p,
          );
          record(
            "project",
            before,
            next,
            group.sources.join("\n"),
            group.attribution.dailyReport
              ? "Added daily work log"
              : options.updateMode === "append"
                ? "Added meeting progress log"
                : "Applied reviewed update",
            reportProgressSource(
              original,
              group.attribution,
              group.sourceTexts,
            ),
          );
        }
        const saved = suggestions.map((s) =>
          saveReviewedReportSuggestion(
            attributedReportSuggestion(
              original.suggestions.find((item) => item.id === s.id)!,
              original,
              timeZone,
            ),
            s,
          ),
        );
        const result = settleMeetingProposal(original, saved, options, {
          appliedResults,
          createdProjectIds,
        });
        state.assistantProposals = (state.assistantProposals ?? []).map((p) =>
          p.id === result.id ? result : p,
        );
        persist();
        return structuredClone(result);
      } catch (e) {
        state = copy;
        throw e;
      }
    },
    async accountDefaults() {
      return { starterPasswordConfigured: true };
    },
    async adminUsers() {
      read();
      return structuredClone(administration().users);
    },
    async saveUser(input, id) {
      read();
      const admin = administration();
      if (id) {
        const parsed = adminUserUpdate.parse(input),
          old = admin.users.find((u) => u.id === id);
        if (!old) throw new ApiError("User not found", 404);
        if (old.version !== parsed.version)
          throw new ApiError("This user changed. Reload before saving.", 409);
        if (admin.users.some((u) => u.id !== id && u.email === parsed.email))
          throw new ApiError("This email is already in use");
        if (old.activationRequired && parsed.status === "active")
          throw new ApiError(
            "A pending user must activate their account first",
          );
        if (!old.activationRequired && parsed.status === "pending")
          throw new ApiError("Active accounts cannot be returned to pending");
        if (
          old.role === "admin" &&
          old.status === "active" &&
          (parsed.role !== "admin" || parsed.status !== "active") &&
          admin.users.filter((u) => u.role === "admin" && u.status === "active")
            .length === 1
        )
          throw new ApiError("Keep at least one active administrator");
        const updated = {
          ...old,
          ...parsed,
          username: loginName(parsed.name, parsed.username || old.username, id),
          version: old.version + 1,
        };
        admin.users = admin.users.map((u) => (u.id === id ? updated : u));
        auditAdmin("Updated user access", id);
        persist();
        return structuredClone(updated);
      }
      const parsed = adminUserInput.parse(input);
      if (admin.users.some((u) => u.email === parsed.email))
        throw new ApiError("This email cannot be used for a new account");
      const created: ManagedUser = {
        ...parsed,
        username: loginName(parsed.name, parsed.username),
        id: crypto.randomUUID(),
        status: parsed.useStarterPassword ? "active" : "pending",
        version: 1,
        activationRequired: !parsed.useStarterPassword,
      };
      admin.users.push(created);
      auditAdmin("Created pending user", created.id);
      persist();
      return structuredClone(created);
    },
    async userActivation(id) {
      read();
      const user = administration().users.find((u) => u.id === id);
      if (!user || user.status !== "pending")
        throw new ApiError("Activation links are only for pending accounts");
      user.status = "active";
      user.activationRequired = false;
      user.version++;
      auditAdmin("Simulated account activation", id);
      persist();
      return {
        token: null,
        expiresAt: new Date().toISOString(),
        simulated: true,
      };
    },
    async activateAccount() {
      throw new ApiError("Demo accounts do not authenticate to the server");
    },
    async catalogs() {
      read();
      return structuredClone(state.catalogs ?? defaultCatalogs);
    },
    async saveCatalogs(input) {
      read();
      const old = state.catalogs ?? defaultCatalogs,
        next = catalogsInput.parse(input);
      if (next.version !== old.version)
        throw new ApiError("Catalog changed. Reload before saving.", 409);
      checkCatalogs(next, old, state.projects);
      next.version++;
      state.catalogs = next;
      auditAdmin("Updated stage and category catalog", actor.workspaceId);
      persist();
      return structuredClone(next);
    },
    async modelAdmin() {
      read();
      return modelState();
    },
    async saveModel(input) {
      read();
      const next = modelSettingsInput.parse(input),
        admin = administration();
      if (next.version !== admin.model.version)
        throw new ApiError(
          "Model settings changed. Reload before saving.",
          409,
        );
      if (next.enabled)
        throw new ApiError(
          "Provision matching server credentials before enabling calls",
        );
      next.version++;
      admin.model = next;
      auditAdmin("Updated model settings", actor.workspaceId);
      persist();
      return modelState();
    },
    async saveModelCredential() {
      throw new ApiError("API keys cannot be saved in the browser demo.");
    },
    async saveModelAllowance(input) {
      read();
      const next = modelAllowanceInput.parse(input),
        admin = administration();
      if (next.version !== admin.model.version)
        throw new ApiError(
          "Model settings changed. Reload before saving.",
          409,
        );
      admin.allowance = {
        maxRequests: next.maxRequests,
        expiresAt: new Date(next.expiresAt).toISOString(),
      };
      admin.model.version++;
      auditAdmin("Simulated model allowance update", actor.workspaceId);
      persist();
      return modelState();
    },
    async modelUsage() {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        measuredRequests: 0,
        unmeasuredRequests: 0,
        pendingRequests: 0,
        last: null,
      };
    },
    async modelLogs() {
      read();
      return structuredClone(administration().logs);
    },
    async adminAudit() {
      read();
      return structuredClone(administration().audit);
    },
    async dailyLogs() {
      read();
      return structuredClone(state.dailyLogs ?? []);
    },
    async saveDailyLog(raw) {
      read();
      const input = dailyLogInput.parse(raw);
      const previous = state.dailyLogs?.find((batch) =>
        input.batchId
          ? batch.id === input.batchId
          : batch.source === input.source &&
            batch.workDate === input.workDate &&
            batch.reporter === input.reporter,
      );
      if (input.batchId && !previous) throw new ApiError("日志批次不存在。");
      if (!input.batchId && previous) return structuredClone(previous);
      const plan = planDailyLog(input, state, previous);
      const backup = structuredClone(state);
      try {
        state.projects.push(...plan.created);
        for (const project of plan.created)
          record(
            "project",
            null,
            project,
            `Daily log ${plan.receipt.id}`,
            "Created project from daily log",
          );
        for (const change of plan.changes) {
          state.projects[
            state.projects.findIndex((p) => p.id === change.after.id)
          ] = change.after;
          record(
            "project",
            change.before,
            change.after,
            `Daily work log ${plan.receipt.id}`,
            "Added daily work log",
            { text: input.source, materialIds: [], workDate: input.workDate },
          );
        }
        state.dailyLogs = [
          plan.receipt,
          ...(state.dailyLogs ?? []).filter(
            (batch) => batch.id !== plan.receipt.id,
          ),
        ];
        persist();
        return structuredClone(plan.receipt);
      } catch (e) {
        state = backup;
        throw e;
      }
    },
    async bulkFillProjects(input) {
      read();
      const changes = planBulkProjectFill(input, state);
      const backup = structuredClone(state);
      try {
        for (const change of changes) {
          state.projects[
            state.projects.findIndex((p) => p.id === change.after.id)
          ] = change.after;
          record(
            "project",
            change.before,
            change.after,
            "Batch project details",
            "Filled project details in batch",
          );
        }
        persist();
        return structuredClone(changes.map((change) => change.after));
      } catch (e) {
        state = backup;
        throw e;
      }
    },
    async intakeHistory() {
      read();
      return structuredClone(state.intakes ?? []);
    },
    async applyIntake(input) {
      read();
      const batch = planIntake(
        intakeInput.parse(input),
        state,
        actor.name,
        () => crypto.randomUUID(),
      );
      for (const project of batch.projects)
        checkProjectCatalog(project, state.catalogs ?? defaultCatalogs);
      for (const p of batch.projects)
        Object.assign(p, projectMembers(p, administration().users));
      for (const t of batch.tasks)
        Object.assign(t, taskMember(t, administration().users));
      const candidateProjects = [...state.projects, ...batch.projects];
      const candidateTasks = [...state.tasks, ...batch.tasks];
      validateGraph(candidateProjects, candidateTasks);
      state.projects = candidateProjects;
      state.tasks = candidateTasks;
      for (const p of batch.projects)
        record(
          "project",
          null,
          p,
          intakeProvenance(batch, p.id),
          "Created project from intake",
        );
      for (const task of batch.tasks)
        record(
          "task",
          null,
          task,
          intakeProvenance(batch, task.id),
          "Created task from intake",
        );
      state.intakes = [batch, ...(state.intakes ?? [])].slice(0, 30);
      persist();
      return structuredClone(batch);
    },
    async undoIntake(id) {
      read();
      const batch = state.intakes?.find((b) => b.id === id);
      if (!batch) throw new ApiError("Intake not found");
      verifyIntakeUndo(batch, state);
      const remainingProjects = state.projects.filter(
        (p) => !batch.projects.some((x) => x.id === p.id),
      );
      const remainingTasks = state.tasks.filter(
        (t) => !batch.tasks.some((x) => x.id === t.id),
      );
      validateGraph(remainingProjects, remainingTasks);
      state.projects = remainingProjects;
      state.tasks = remainingTasks;
      for (const p of batch.projects)
        record("project", p, null, `Intake undo · ${batch.id}`, "Undid intake");
      for (const task of batch.tasks)
        record("task", task, null, `Intake undo · ${batch.id}`, "Undid intake");
      batch.state = "undone";
      batch.undoneAt = new Date().toISOString();
      persist();
      return structuredClone(batch);
    },
    async restore(id, version) {
      read();
      const a = state.activities.find((x) => x.id === id);
      if (!a?.before) throw new ApiError("No restorable version");
      if (
        ("voided" in a.before && a.before.voided) ||
        (a.after && "voided" in a.after && a.after.voided)
      )
        throw new ApiError(
          "请在任务的已作废列表中恢复，确保同批子任务一起恢复。",
        );
      if (a.source === "Project merge")
        throw new ApiError(
          "Project merges cannot be restored as a single record.",
        );
      const taskBefore =
        a.kind === "task" ? taskInput.strip().parse(a.before) : null;
      if (taskBefore) taskBefore.assigneeId = taskBefore.assigneeId ?? null;
      if (
        taskBefore &&
        !state.projects.some((p) => p.id === taskBefore.projectId)
      )
        taskBefore.projectId = state.tasks.find(
          (t) => t.id === a.entityId,
        )!.projectId;
      return a.kind === "project"
        ? saveProject(
            projectInput.strip().parse(a.before),
            a.entityId,
            version,
            "History restore",
          )
        : saveTask(taskBefore!, a.entityId, version, "History restore");
    },
  };
}
