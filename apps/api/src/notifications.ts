import { createHash, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { dayKey } from "../../../packages/domain/types.js";
import type {
  Actor,
  Activity,
  Project,
  Snapshot,
  Task,
} from "../../../packages/domain/types.js";
import {
  defaultNotificationPreferences,
  deriveNotifications,
  notificationActionInput,
  notificationFollowingInput,
  notificationPreferencesInput,
  isNotificationQuietTime,
  type NotificationCandidate,
  type NotificationItem,
  type NotificationPreferences,
  type NotificationResponse,
} from "../../../packages/domain/notifications.js";
import {
  notificationConfigInput,
  type NotificationAdminState,
} from "../../../packages/domain/notification-delivery.js";
import { Repository, HttpError } from "./database.js";
import { adminActor, adminAudit } from "./admin.js";
import type { Mutate } from "./intake.js";
import { NotificationCredentialStore } from "./notification-credentials.js";
import {
  NotificationWecomSender,
  composeNotificationText,
} from "./notification-wecom.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = (value: Date) => value.toISOString();
type StoredMessage = {
  item: NotificationItem;
  generation: number;
  signature: string;
};
type ReconcileOptions = { suppress?: boolean };
const externalKinds = new Set(["task_risk", "assignment", "task_change"]);

export class NotificationService {
  private sender: NotificationWecomSender;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private closed = false;
  constructor(
    readonly repo: Repository,
    readonly credentials: NotificationCredentialStore,
    private options: {
      fetcher?: typeof fetch;
      clock?: () => Date;
      directoryCorpId?: (ws: string) => string;
      intervalMs?: number;
    } = {},
  ) {
    this.sender = new NotificationWecomSender(options.fetcher);
  }
  now() {
    return this.options.clock?.() ?? new Date();
  }
  private account(ws: string, userId: string) {
    const row = this.repo.db
      .prepare(
        "SELECT preferences,following FROM notification_accounts WHERE workspace_id=? AND user_id=?",
      )
      .get(ws, userId);
    return {
      preferences: row
        ? notificationPreferencesInput.parse(
            JSON.parse(String(row.preferences)),
          )
        : { ...defaultNotificationPreferences },
      following: row ? (JSON.parse(String(row.following)) as string[]) : [],
    };
  }
  private saveAccount(
    ws: string,
    userId: string,
    preferences: NotificationPreferences,
    following: string[],
  ) {
    this.repo.db
      .prepare(
        "INSERT INTO notification_accounts(workspace_id,user_id,preferences,following) VALUES(?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET preferences=excluded.preferences,following=excluded.following",
      )
      .run(ws, userId, JSON.stringify(preferences), JSON.stringify(following));
  }
  private rows(ws: string, userId?: string): StoredMessage[] {
    const rows = userId
      ? this.repo.db
          .prepare(
            "SELECT generation,signature,data FROM notifications WHERE workspace_id=? AND user_id=?",
          )
          .all(ws, userId)
      : this.repo.db
          .prepare(
            "SELECT generation,signature,data FROM notifications WHERE workspace_id=?",
          )
          .all(ws);
    return rows.map((row) => ({
      item: JSON.parse(String(row.data)) as NotificationItem,
      generation: Number(row.generation),
      signature: String(row.signature),
    }));
  }
  private write(item: NotificationItem) {
    this.repo.db
      .prepare("UPDATE notifications SET data=? WHERE id=?")
      .run(JSON.stringify(item), item.id);
  }
  private cancel(id: string, reason: string) {
    this.repo.db
      .prepare(
        "UPDATE notification_outbox SET state='cancelled',error=?,updated_at=? WHERE notification_id=? AND state IN ('pending','blocked','failed')",
      )
      .run(reason, iso(this.now()), id);
  }
  private upsert(
    ws: string,
    userId: string,
    candidate: NotificationCandidate,
    emit: boolean,
  ) {
    const row = this.repo.db
      .prepare(
        "SELECT id,generation,signature,data FROM notifications WHERE workspace_id=? AND user_id=? AND logical_key=?",
      )
      .get(ws, userId, candidate.key);
    const previous = row
      ? (JSON.parse(String(row.data)) as NotificationItem)
      : undefined;
    const signature = hash({
      kind: candidate.kind,
      reasons: candidate.reasons,
      tags: candidate.tags,
      dueAt: candidate.dueAt,
    });
    const changed =
      !previous || !!previous.resolvedAt || row!.signature !== signature;
    const generation = Number(row?.generation ?? 0) + (changed ? 1 : 0);
    const now = iso(this.now());
    const item: NotificationItem = {
      ...candidate,
      id: previous?.id ?? randomUUID(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: changed ? now : previous!.updatedAt,
      readAt: changed ? null : previous!.readAt,
      resolvedAt: null,
      snoozedUntil: previous?.snoozedUntil ?? null,
    };
    this.repo.db
      .prepare(
        "INSERT INTO notifications(id,workspace_id,user_id,logical_key,generation,signature,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id,logical_key) DO UPDATE SET generation=excluded.generation,signature=excluded.signature,data=excluded.data",
      )
      .run(
        item.id,
        ws,
        userId,
        item.key,
        generation,
        signature,
        JSON.stringify(item),
      );
    if (changed) this.cancel(item.id, "事项提醒条件已变化，旧投递已关闭。");
    if (changed && emit && candidate.kind !== "project_metadata")
      this.enqueue(ws, userId, item, generation);
    return item;
  }
  private enqueue(
    ws: string,
    userId: string,
    item: NotificationItem,
    generation: number,
  ) {
    if (item.kind === "project_metadata") return;
    const prefs = this.account(ws, userId).preferences;
    if (
      ["in_app", "muted"].includes(prefs.delivery) ||
      (prefs.delivery === "important" && !externalKinds.has(item.kind))
    )
      return;
    const now = iso(this.now());
    this.repo.db
      .prepare(
        "INSERT OR IGNORE INTO notification_outbox(id,workspace_id,user_id,notification_id,generation,state,next_at,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?)",
      )
      .run(randomUUID(), ws, userId, item.id, generation, now, now, now);
  }
  /** Called inside the same transaction as a business change, or from a timer transaction. */
  reconcileWorkspace(ws: string, options: ReconcileOptions = {}) {
    const snapshot = this.repo.snapshot(ws),
      now = this.now();
    const cursor = this.repo.db
      .prepare(
        "SELECT activity_row FROM notification_cursors WHERE workspace_id=?",
      )
      .get(ws);
    const through = Number(
      this.repo.db
        .prepare(
          "SELECT COALESCE(MAX(rowid),0) AS n FROM activities WHERE workspace_id=?",
        )
        .get(ws)!.n,
    );
    const events = cursor
      ? this.repo.db
          .prepare(
            "SELECT rowid,data FROM activities WHERE workspace_id=? AND rowid>? AND rowid<=? ORDER BY rowid",
          )
          .all(ws, Number(cursor.activity_row), through)
          .map((row) => ({
            row: Number(row.rowid),
            event: JSON.parse(String(row.data)) as Activity,
          }))
      : [];
    const suppress =
      options.suppress ||
      events.some(
        ({ event }) =>
          event.kind === "import" ||
          /Restored previous version|恢复已作废|Undid intake/.test(
            event.action,
          ),
      );
    if (events.some(({ event }) => event.kind === "import")) {
      for (const { item } of this.rows(ws)) {
        item.resolvedAt = iso(now);
        this.write(item);
        this.cancel(item.id, "工作区数据已替换，旧通知停止投递。");
      }
    }
    const activeUsers = this.repo.db
      .prepare(
        "SELECT id,name,role FROM users WHERE workspace_id=? AND status='active' AND requires_activation=0",
      )
      .all(ws);
    for (const user of activeUsers) {
      const id = String(user.id),
        candidates = deriveNotifications(snapshot, id, now, {
          isAdmin: user.role === "admin",
        });
      const account = this.account(ws, id),
        following = [
          ...new Set(
            account.following
              .map((value) => this.resolveProject(ws, value))
              .filter((value) =>
                snapshot.projects.some((project) => project.id === value),
              ),
          ),
        ];
      if (JSON.stringify(following) !== JSON.stringify(account.following))
        this.saveAccount(ws, id, account.preferences, following);
      if (user.role === "admin") {
        const parents = new Set(
          snapshot.tasks.map((task) => task.parentId).filter(Boolean),
        );
        const validProjectIds = new Set(
          snapshot.projects
            .filter((project) => !project.intakeInbox)
            .map((project) => project.id),
        );
        const inactive =
          snapshot.members?.filter((member) => member.status !== "active") ??
          [];
        for (const former of inactive) {
          const open = snapshot.tasks.filter(
            (task) =>
              task.assigneeId === former.id &&
              task.status !== "done" &&
              !task.voided &&
              !parents.has(task.id) &&
              validProjectIds.has(task.projectId),
          );
          if (open.length)
            candidates.push({
              key: `handover:${former.id}`,
              kind: "delivery_issue",
              severity: "warning",
              title: `${former.name}的事项需要交接`,
              body: `有 ${open.length} 项未完成工作仍分配给已停用账号。`,
              reason: "账号已停用，请重新安排负责人。",
              reasons: ["账号已停用"],
              projectId: open[0]!.projectId,
              taskId: open.length === 1 ? open[0]!.id : null,
              dueAt: null,
              actionable: true,
            });
        }
        const today = dayKey(now, snapshot.settings?.timeZone ?? "UTC");
        const tomorrow = Temporal.PlainDate.from(today)
          .add({ days: 1 })
          .toString();
        for (const project of snapshot.projects.filter(
          (project) => !project.intakeInbox && !project.ownerId,
        )) {
          const unrouted = snapshot.tasks.filter(
            (task) =>
              task.projectId === project.id &&
              !task.assigneeId &&
              !task.voided &&
              task.status !== "done" &&
              !parents.has(task.id) &&
              (task.status === "blocked" ||
                (task.reminderAt &&
                  Date.parse(task.reminderAt) <= now.getTime()) ||
                (task.dueDate && task.dueDate <= tomorrow)),
          );
          if (unrouted.length)
            candidates.push({
              key: `unrouted:${project.id}`,
              kind: "delivery_issue",
              severity: "warning",
              title: `${project.name} · 提醒接收人待核对`,
              body: `${unrouted.length} 项需要跟进的事项尚未关联接收账号。`,
              reason: "请关联任务负责人账号，或指定项目负责人。",
              reasons: ["提醒接收人尚未确定"],
              projectId: project.id,
              taskId: unrouted.length === 1 ? unrouted[0]!.id : null,
              dueAt: null,
              actionable: true,
            });
        }
      }
      const keys = new Set(candidates.map((candidate) => candidate.key));
      for (const candidate of candidates)
        this.upsert(ws, id, candidate, !!cursor && !suppress);
      for (const { item } of this.rows(ws, id)) {
        const derived = [
          "task_risk",
          "project_metadata",
          "delivery_issue",
        ].includes(item.kind);
        const closedEvent = !this.eventRelevant(ws, id, item);
        if (
          !item.resolvedAt &&
          ((derived && !keys.has(item.key)) || closedEvent)
        ) {
          item.resolvedAt = iso(now);
          item.updatedAt = iso(now);
          this.write(item);
          this.cancel(item.id, "事项已完成、作废、移交或不再符合提醒条件。");
        }
      }
    }
    this.repo.db
      .prepare(
        "UPDATE notification_outbox SET state='cancelled',error='接收账号已停用或不存在',updated_at=? WHERE workspace_id=? AND state IN ('pending','blocked','failed') AND user_id NOT IN (SELECT id FROM users WHERE workspace_id=? AND status='active' AND requires_activation=0)",
      )
      .run(iso(now), ws, ws);
    if (cursor && !suppress) this.processEvents(ws, snapshot, events);
    this.repo.db
      .prepare(
        "INSERT INTO notification_cursors(workspace_id,activity_row,initialized_at) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET activity_row=excluded.activity_row",
      )
      .run(ws, through, iso(now));
  }
  private processEvents(
    ws: string,
    snapshot: Snapshot,
    events: { row: number; event: Activity }[],
  ) {
    const groups = new Map<
      string,
      {
        recipient: string;
        events: Activity[];
        candidate: NotificationCandidate;
      }
    >();
    const add = (
      recipient: string,
      event: Activity,
      candidate: NotificationCandidate,
    ) => {
      if (
        recipient === event.actorId ||
        !snapshot.members?.some(
          (member) => member.id === recipient && member.status === "active",
        )
      )
        return;
      const key = `${recipient}:${candidate.kind}:${candidate.projectId}`;
      const old = groups.get(key);
      if (old) old.events.push(event);
      else groups.set(key, { recipient, events: [event], candidate });
    };
    for (const { event } of events) {
      if (
        /Project merge|Progress correction/.test(event.source) ||
        /Undid|Restored|恢复/.test(event.action)
      )
        continue;
      if (event.kind === "task" && event.after && "assignee" in event.after) {
        const after = event.after as Task,
          before = event.before as Task | null;
        if (after.voided || after.status === "done") continue;
        const project = snapshot.projects.find(
          (value) => value.id === after.projectId,
        );
        const base = {
          title: after.title,
          body: after.title,
          projectId: after.projectId,
          taskId: after.id,
          dueAt: after.reminderAt ?? null,
          severity: "info" as const,
          actionable: false,
          tags: [],
        };
        if (after.assigneeId && after.assigneeId !== before?.assigneeId)
          add(after.assigneeId, event, {
            ...base,
            key: "",
            kind: "assignment",
            reason: `${event.actor}将任务分配给你。`,
            reasons: ["新分配的任务"],
          });
        else if (
          after.assigneeId &&
          before &&
          (after.dueDate !== before.dueDate ||
            after.reminderAt !== before.reminderAt ||
            after.estimatedDate !== before.estimatedDate ||
            JSON.stringify(after.workDates) !==
              JSON.stringify(before.workDates) ||
            after.workWeek !== before.workWeek)
        )
          add(after.assigneeId, event, {
            ...base,
            key: "",
            kind: "task_change",
            reason: `${event.actor}调整了工作安排或时间，请查看当前安排。`,
            reasons: ["工作安排已调整"],
          });
        if (
          project?.ownerId &&
          after.status === "blocked" &&
          before?.status !== "blocked"
        )
          add(project.ownerId, event, {
            ...base,
            key: "",
            kind: "task_change",
            severity: "warning",
            reason: `${event.actor}标记任务需要协调。`,
            reasons: ["需要协调"],
          });
      }
      if (
        event.kind === "project" &&
        event.after &&
        "latestUpdate" in event.after
      ) {
        const after = event.after as Project,
          before = event.before as Project | null;
        const base = {
          key: "",
          severity: "info" as const,
          projectId: after.id,
          taskId: null,
          dueAt: null,
          actionable: false,
          tags: [],
        };
        if (after.ownerId && after.ownerId !== before?.ownerId)
          add(after.ownerId, event, {
            ...base,
            kind: "assignment",
            title: `你已负责：${after.name}`,
            body: after.name,
            reason: `${event.actor}将项目分配给你。`,
            reasons: ["项目负责人已调整"],
          });
        if (
          after.latestUpdate.trim() &&
          after.latestUpdate !== before?.latestUpdate
        ) {
          const recipients = new Set<string>([
            after.ownerId ?? "",
            ...(after.participantIds ?? []),
            ...(snapshot.projectMembers ?? [])
              .filter((m) => m.projectId === after.id)
              .map((m) => m.userId),
          ]);
          for (const row of this.repo.db
            .prepare(
              "SELECT user_id,following FROM notification_accounts WHERE workspace_id=?",
            )
            .all(ws))
            if (
              (JSON.parse(String(row.following)) as string[]).includes(after.id)
            )
              recipients.add(String(row.user_id));
          for (const userId of recipients)
            if (userId)
              add(userId, event, {
                ...base,
                kind: "project_update",
                title: after.name,
                body: after.latestUpdate.slice(0, 600),
                reason: `${event.actor}记录了新的项目进展。`,
                reasons: ["与你有关的项目动态"],
              });
        }
      }
    }
    for (const { recipient, events: batch, candidate } of groups.values()) {
      candidate.key = `event:${batch.at(-1)!.id}:${candidate.kind}:${recipient}`;
      if (batch.length > 1) {
        candidate.title = `${candidate.kind === "assignment" ? "新增分配" : candidate.kind === "project_update" ? "项目动态" : "工作安排更新"} · ${batch.length} 项`;
        candidate.body = batch
          .map((e) =>
            e.after && "title" in e.after
              ? e.after.title
              : e.after && "name" in e.after
                ? e.after.name
                : "",
          )
          .filter(Boolean)
          .slice(0, 8)
          .join("；");
        candidate.taskId = null;
        candidate.taskIds = batch
          .filter((e) => e.kind === "task")
          .map((e) => e.entityId);
      }
      this.upsert(ws, recipient, candidate, true);
    }
  }
  private binding(ws: string, userId: string) {
    const stored = this.credentials.read(ws),
      config = stored?.config;
    const directory = this.repo.directory(ws),
      employee = directory.employees.find((value) => value.userId === userId);
    const user = this.repo.db
      .prepare(
        "SELECT status,requires_activation FROM users WHERE workspace_id=? AND id=?",
      )
      .get(ws, userId);
    const scope = this.repo.db
      .prepare(
        "SELECT corp_id,synced_at FROM notification_directory_scope WHERE workspace_id=?",
      )
      .get(ws);
    const verified =
      !!config?.corpId &&
      !!scope &&
      scope.corp_id === config.corpId &&
      (this.options.directoryCorpId?.(ws) ?? config.corpId) === config.corpId;
    const binding = this.repo.db
      .prepare(
        "SELECT * FROM notification_bindings WHERE workspace_id=? AND user_id=?",
      )
      .get(ws, userId);
    const fingerprint = employee
      ? hash([employee.id, employee.userId, employee.wecomUserId])
      : "";
    let reason = "";
    if (!config?.enabled) reason = "企业微信通知尚未启用，站内提醒正常保留。";
    else if (!user || user.status !== "active" || user.requires_activation)
      reason = "本地账号未启用。";
    else if (!verified)
      reason = "请使用当前企业配置同步通讯录，再核对通知接收人。";
    else if (!employee?.active || !employee.wecomUserId)
      reason = "员工尚未关联有效的企业微信成员。";
    else if (
      employee.wecomCorpId !== config.corpId ||
      employee.wecomSeenAt !== scope!.synced_at
    )
      reason = "当前通讯录同步未确认该成员，请核验应用可见范围或重新同步。";
    else if (
      !binding ||
      binding.corp_id !== config.corpId ||
      binding.wecom_user_id !== employee.wecomUserId ||
      binding.fingerprint !== fingerprint
    )
      reason = "请管理员确认本地账号与企业微信成员的通知绑定。";
    return {
      config,
      version: stored?.version ?? 0,
      employee,
      binding,
      verified,
      fingerprint,
      reason,
      valid: !reason,
    };
  }
  state(a: Actor): NotificationResponse {
    const now = this.now(),
      all = this.rows(a.workspaceId, a.id).map((row) => row.item);
    const pendingCount = all.filter(
      (item) => item.actionable && !item.resolvedAt,
    ).length;
    const unreadCount = all.filter(
      (item) =>
        !item.resolvedAt &&
        !item.readAt &&
        (!item.snoozedUntil || Date.parse(item.snoozedUntil) <= now.getTime()),
    ).length;
    const account = this.account(a.workspaceId, a.id),
      binding = this.binding(a.workspaceId, a.id);
    return {
      items: all
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 1000),
      unreadCount,
      pendingCount,
      followingIds: account.following,
      preferences: account.preferences,
      timeZone: this.repo.settings(a.workspaceId).timeZone,
      asOf: iso(now),
      deliveryStatus: {
        configured: !!binding.config?.enabled,
        bound: binding.valid,
        reason: binding.reason,
      },
    };
  }
  action(a: Actor, raw: unknown) {
    const input = notificationActionInput.parse(raw),
      now = iso(this.now());
    const rows = this.rows(a.workspaceId, a.id),
      items = input.ids.map(
        (id) => rows.find((row) => row.item.id === id)?.item,
      );
    if (items.some((item) => !item))
      throw new HttpError(404, "提醒不存在或不属于当前账号。");
    if (
      input.action === "snooze" &&
      (!input.until ||
        Date.parse(input.until) <= this.now().getTime() ||
        Date.parse(input.until) > this.now().getTime() + 30 * 86400000)
    )
      throw new HttpError(400, "稍后提醒时间应在未来30天内。");
    for (const item of items as NotificationItem[]) {
      if (input.action === "read") {
        item.readAt = now;
        if (!item.actionable) item.resolvedAt = now;
      }
      if (input.action === "unread") {
        item.readAt = null;
        if (!item.actionable) item.resolvedAt = null;
      }
      if (input.action === "snooze") {
        if (item.resolvedAt)
          throw new HttpError(409, "这条事项已处理，无需再次提醒。");
        item.snoozedUntil = new Date(input.until!).toISOString();
        item.readAt = null;
        // A personal reschedule is a fresh occurrence, even if its previous
        // channel delivery was accepted. The task's business dates stay intact.
        this.cancel(item.id, "个人稍后提醒时间已更新。");
        this.repo.db
          .prepare(
            "UPDATE notifications SET generation=generation+1 WHERE id=?",
          )
          .run(item.id);
      }
      if (input.action === "unsnooze") {
        item.snoozedUntil = null;
        this.cancel(item.id, "已取消个人稍后提醒，事项仍保留在当前待办。");
      }
      item.updatedAt = now;
      this.write(item);
      if (input.action === "snooze") {
        const generation = Number(
          this.repo.db
            .prepare("SELECT generation FROM notifications WHERE id=?")
            .get(item.id)!.generation,
        );
        this.enqueue(a.workspaceId, a.id, item, generation);
      }
      if (item.resolvedAt) this.cancel(item.id, "动态已阅读，不再外推。");
    }
    return this.state(a);
  }
  preferences(a: Actor, raw: unknown) {
    const input = notificationPreferencesInput.parse(raw),
      current = this.account(a.workspaceId, a.id);
    if (input.version !== current.preferences.version)
      throw new HttpError(409, "提醒设置已在其他设备更新，请刷新后重试。");
    this.saveAccount(
      a.workspaceId,
      a.id,
      { ...input, version: input.version + 1 },
      current.following,
    );
    if (["muted", "in_app"].includes(input.delivery))
      this.repo.db
        .prepare(
          "UPDATE notification_outbox SET state='cancelled',error='接收人已关闭站外通知',updated_at=? WHERE workspace_id=? AND user_id=? AND state IN ('pending','blocked','failed')",
        )
        .run(iso(this.now()), a.workspaceId, a.id);
    return this.state(a);
  }
  following(a: Actor, raw: unknown) {
    const input = notificationFollowingInput.parse(raw),
      current = this.account(a.workspaceId, a.id);
    const projectIds = [
      ...new Set(
        input.projectIds.map((id) => this.resolveProject(a.workspaceId, id)),
      ),
    ];
    for (const id of projectIds)
      if (
        !this.repo.db
          .prepare("SELECT 1 FROM projects WHERE workspace_id=? AND id=?")
          .get(a.workspaceId, id)
      )
        throw new HttpError(400, "关注项目不存在，请刷新列表。");
    const ids =
      input.mode === "merge"
        ? [...new Set([...current.following, ...projectIds])]
        : projectIds;
    this.saveAccount(a.workspaceId, a.id, current.preferences, ids);
    return this.state(a);
  }
  resolveProject(ws: string, id: string) {
    const seen = new Set<string>();
    while (!seen.has(id) && seen.size < 50) {
      seen.add(id);
      if (
        this.repo.db
          .prepare("SELECT 1 FROM projects WHERE workspace_id=? AND id=?")
          .get(ws, id)
      )
        return id;
      const row = this.repo.db
        .prepare(
          "SELECT target_id FROM project_redirects WHERE workspace_id=? AND source_id=?",
        )
        .get(ws, id);
      if (!row) return id;
      id = String(row.target_id);
    }
    throw new HttpError(409, "项目合并关联需要核对。");
  }
  open(a: Actor, id: string) {
    const row = this.repo.db
      .prepare(
        "SELECT data FROM notifications WHERE id=? AND workspace_id=? AND user_id=?",
      )
      .get(id, a.workspaceId, a.id);
    if (!row) throw new HttpError(404, "消息不存在或不属于当前账号。");
    const item = JSON.parse(String(row.data)) as NotificationItem;
    if (item.taskId) {
      const task = this.repo.db
        .prepare("SELECT project_id FROM tasks WHERE workspace_id=? AND id=?")
        .get(a.workspaceId, item.taskId);
      if (task)
        return {
          path: `/projects/${encodeURIComponent(String(task.project_id))}?task=${encodeURIComponent(item.taskId)}`,
        };
    }
    const projectId = item.projectId
      ? this.resolveProject(a.workspaceId, item.projectId)
      : null;
    if (
      projectId &&
      this.repo.db
        .prepare("SELECT 1 FROM projects WHERE workspace_id=? AND id=?")
        .get(a.workspaceId, projectId)
    )
      return {
        path: `/projects/${encodeURIComponent(projectId)}${item.kind === "project_update" ? "#progress-history" : ""}`,
      };
    return { path: "/projects" };
  }
  adminState(a: Actor): NotificationAdminState {
    adminActor(this.repo, a);
    const stored = this.credentials.read(a.workspaceId),
      config = stored?.config;
    const directory = this.repo.directory(a.workspaceId),
      scope = this.repo.db
        .prepare(
          "SELECT corp_id FROM notification_directory_scope WHERE workspace_id=?",
        )
        .get(a.workspaceId);
    const directoryCorpId =
      this.options.directoryCorpId?.(a.workspaceId) ??
      String(scope?.corp_id ?? "");
    return {
      config: {
        version: stored?.version ?? 0,
        enabled: config?.enabled ?? false,
        corpId: config?.corpId ?? "",
        agentId: config?.agentId ?? 0,
        baseUrl: config?.baseUrl ?? "",
        secretConfigured: !!config?.secret,
      },
      directoryCorpId,
      directoryVerified:
        !!scope &&
        scope.corp_id === config?.corpId &&
        directoryCorpId === config?.corpId,
      bindings: directory.employees.map((employee) => {
        const binding = this.binding(a.workspaceId, employee.userId ?? "");
        const active =
          employee.active &&
          !!this.repo.db
            .prepare(
              "SELECT 1 FROM users WHERE workspace_id=? AND id=? AND status='active' AND requires_activation=0",
            )
            .get(a.workspaceId, employee.userId!) &&
          employee.wecomCorpId === config?.corpId &&
          employee.wecomSeenAt ===
            this.repo.db
              .prepare(
                "SELECT synced_at FROM notification_directory_scope WHERE workspace_id=?",
              )
              .get(a.workspaceId)?.synced_at;
        return {
          employeeId: employee.id,
          userId: employee.userId ?? "",
          name: employee.name,
          wecomUserId: employee.wecomUserId,
          active,
          confirmed: binding.valid,
          reason: employee.userId
            ? binding.reason
            : "请先在团队通讯录中关联登录账号。",
        };
      }),
      deliveries: this.repo.db
        .prepare(
          "SELECT o.*,u.name,n.data FROM notification_outbox o JOIN users u ON u.id=o.user_id JOIN notifications n ON n.id=o.notification_id WHERE o.workspace_id=? ORDER BY o.created_at DESC LIMIT 100",
        )
        .all(a.workspaceId)
        .map((row) => ({
          id: String(row.id),
          recipient: String(row.name),
          title: (JSON.parse(String(row.data)) as NotificationItem).title,
          state: String(row.state),
          attempts: Number(row.attempts),
          error: String(row.error),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          externalId: row.external_id ? String(row.external_id) : null,
        })),
    };
  }
  saveConfig(a: Actor, raw: unknown) {
    adminActor(this.repo, a);
    const input = notificationConfigInput.parse(raw),
      old = this.credentials.read(a.workspaceId);
    if (input.version !== (old?.version ?? 0))
      throw new HttpError(409, "通知应用配置已更新，请重新打开后保存。");
    const secret =
      input.secret ||
      (old?.config.corpId === input.corpId &&
      old.config.agentId === input.agentId
        ? old.config.secret
        : "");
    if (input.enabled && !secret)
      throw new HttpError(400, "请填写通知应用的 Secret。");
    this.credentials.save(a.workspaceId, input.version + 1, {
      enabled: input.enabled,
      corpId: input.corpId,
      agentId: input.agentId,
      baseUrl: input.baseUrl,
      secret,
    });
    this.repo.db
      .prepare(
        "UPDATE notification_outbox SET state='cancelled',error='通知应用配置已变更，旧投递停止',updated_at=? WHERE workspace_id=? AND state IN ('pending','blocked','failed')",
      )
      .run(iso(this.now()), a.workspaceId);
    adminAudit(
      this.repo,
      a,
      "Updated notification application configuration",
      a.workspaceId,
    );
    return this.adminState(a);
  }
  confirmBindings(a: Actor, raw: unknown) {
    adminActor(this.repo, a);
    const input = z
      .object({
        employeeIds: z.array(z.string().min(1)).min(1).max(500),
        configVersion: z.number().int().positive(),
      })
      .strict()
      .parse(raw);
    const current = this.credentials.read(a.workspaceId);
    if (!current?.config.enabled || current.version !== input.configVersion)
      throw new HttpError(409, "请先保存并启用当前企业的通知应用配置。");
    const directory = this.repo.directory(a.workspaceId),
      scope = this.repo.db
        .prepare(
          "SELECT corp_id,synced_at FROM notification_directory_scope WHERE workspace_id=?",
        )
        .get(a.workspaceId);
    if (
      !scope ||
      scope.corp_id !== current.config.corpId ||
      this.options.directoryCorpId?.(a.workspaceId) !== current.config.corpId
    )
      throw new HttpError(400, "请先使用同一企业配置同步通讯录，再确认绑定。");
    for (const id of input.employeeIds) {
      const employee = directory.employees.find((value) => value.id === id);
      if (
        !employee?.userId ||
        !employee.active ||
        !employee.wecomUserId ||
        (employee.wecomUserId.toLowerCase()==="@all" || /[|\s]/.test(employee.wecomUserId)) ||
        employee.wecomCorpId !== current.config.corpId ||
        employee.wecomSeenAt !== scope.synced_at ||
        !this.repo.db
          .prepare(
            "SELECT 1 FROM users WHERE workspace_id=? AND id=? AND status='active' AND requires_activation=0",
          )
          .get(a.workspaceId, employee.userId)
      )
        throw new HttpError(
          400,
          "所选成员尚未完成本地账号关联，或不在本次企业通讯录同步结果中。",
        );
      this.repo.db
        .prepare(
          "INSERT INTO notification_bindings(workspace_id,user_id,employee_id,corp_id,wecom_user_id,fingerprint,version,confirmed_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET employee_id=excluded.employee_id,corp_id=excluded.corp_id,wecom_user_id=excluded.wecom_user_id,fingerprint=excluded.fingerprint,version=notification_bindings.version+1,confirmed_at=excluded.confirmed_at",
        )
        .run(
          a.workspaceId,
          employee.userId,
          employee.id,
          current.config.corpId,
          employee.wecomUserId,
          hash([employee.id, employee.userId, employee.wecomUserId]),
          iso(this.now()),
        );
      this.repo.db
        .prepare(
          "UPDATE notification_outbox SET state=CASE WHEN created_at>=? THEN 'pending' ELSE 'cancelled' END,next_at=?,updated_at=?,error=CASE WHEN created_at>=? THEN '' ELSE '过旧提醒保留在站内，请查看当前待办' END WHERE workspace_id=? AND user_id=? AND state='blocked'",
        )
        .run(
          new Date(this.now().getTime() - 86400000).toISOString(),
          iso(this.now()),
          iso(this.now()),
          new Date(this.now().getTime() - 86400000).toISOString(),
          a.workspaceId,
          employee.userId,
        );
    }
    adminAudit(
      this.repo,
      a,
      "Confirmed notification recipient bindings",
      a.workspaceId,
    );
    return this.adminState(a);
  }
  retry(a: Actor, raw: unknown) {
    adminActor(this.repo, a);
    const input = z
      .object({ id: z.string(), confirmUnknown: z.boolean().optional() })
      .strict()
      .parse(raw);
    const row = this.repo.db
      .prepare(
        "SELECT state FROM notification_outbox WHERE id=? AND workspace_id=?",
      )
      .get(input.id, a.workspaceId);
    if (!row) throw new HttpError(404, "投递记录不存在。");
    if (row.state === "unknown" && !input.confirmUnknown)
      throw new HttpError(
        409,
        "上次发送结果不明，重新发送可能重复；请核查后明确确认。",
      );
    if (!["failed", "blocked", "unknown"].includes(String(row.state)))
      throw new HttpError(400, "仅失败、待核验或结果不明的投递可重试。");
    this.repo.db
      .prepare(
        "UPDATE notification_outbox SET state='pending',attempts=0,next_at=?,updated_at=?,error='' WHERE id=?",
      )
      .run(iso(this.now()), iso(this.now()), input.id);
    adminAudit(this.repo, a, "Retried notification delivery", input.id);
    return this.adminState(a);
  }
  private nextClock(now: Date, time: string, timeZone: string) {
    const zoned = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(
      timeZone,
    );
    const clock = Temporal.PlainTime.from(time);
    let target = zoned
      .toPlainDate()
      .toZonedDateTime({ timeZone, plainTime: clock });
    if (target.epochMilliseconds <= now.getTime())
      target = zoned
        .toPlainDate()
        .add({ days: 1 })
        .toZonedDateTime({ timeZone, plainTime: clock });
    return target.toInstant().toString();
  }
  private eventRelevant(ws: string, userId: string, item: NotificationItem) {
    if (!["assignment", "task_change"].includes(item.kind)) return true;
    const ids = item.taskIds?.length
      ? item.taskIds
      : item.taskId
        ? [item.taskId]
        : [];
    if (ids.length)
      return ids.some((id) => {
        const row = this.repo.db
          .prepare("SELECT data FROM tasks WHERE workspace_id=? AND id=?")
          .get(ws, id);
        if (!row) return false;
        const task = JSON.parse(String(row.data)) as Task;
        if (task.status === "done" || task.voided) return false;
        if (task.assigneeId === userId) return true;
        if (
          item.kind === "task_change" &&
          task.status === "blocked" &&
          item.reasons.includes("需要协调")
        ) {
          const project = this.repo.db
            .prepare("SELECT data FROM projects WHERE workspace_id=? AND id=?")
            .get(ws, task.projectId);
          return (
            project &&
            (JSON.parse(String(project.data)) as Project).ownerId === userId
          );
        }
        return false;
      });
    if (item.kind === "assignment" && item.projectId) {
      const row = this.repo.db
        .prepare("SELECT data FROM projects WHERE workspace_id=? AND id=?")
        .get(ws, this.resolveProject(ws, item.projectId));
      return (
        !!row && (JSON.parse(String(row.data)) as Project).ownerId === userId
      );
    }
    return true;
  }
  private validDelivery(row: Record<string, unknown>, processing = false) {
    const ws = String(row.workspace_id),
      userId = String(row.user_id),
      now = iso(this.now());
    const message = this.repo.db
      .prepare(
        "SELECT generation,data FROM notifications WHERE id=? AND workspace_id=? AND user_id=?",
      )
      .get(String(row.notification_id), ws, userId);
    if (!message || Number(message.generation) !== Number(row.generation))
      return { valid: false, reason: "提醒条件已更新。" };
    const item = JSON.parse(String(message.data)) as NotificationItem;
    if (item.resolvedAt)
      return { valid: false, reason: "事项已处理或提醒条件已解除。" };
    if (!this.eventRelevant(ws, userId, item))
      return { valid: false, reason: "事项已完成或责任已转移。" };
    if (item.snoozedUntil && item.snoozedUntil > now)
      return {
        valid: false,
        reason: "接收人选择稍后提醒。",
        until: item.snoozedUntil,
      };
    const prefs = this.account(ws, userId).preferences;
    if (processing) {
      const timeZone = this.repo.settings(ws).timeZone;
      if (isNotificationQuietTime(this.now(), timeZone, prefs))
        return {
          valid: false,
          reason: "当前处于安静时段。",
          until: this.nextClock(this.now(), prefs.quietEnd, timeZone),
        };
      if (prefs.delivery === "digest") {
        const next = this.nextClock(
          new Date(String(row.created_at)),
          prefs.digestTime,
          timeZone,
        );
        if (Date.parse(next) > this.now().getTime())
          return { valid: false, reason: "等待摘要时间。", until: next };
      }
    }
    if (
      ["in_app", "muted"].includes(prefs.delivery) ||
      (prefs.delivery === "important" && !externalKinds.has(item.kind))
    )
      return { valid: false, reason: "接收人已关闭此类站外通知。" };
    const binding = this.binding(ws, userId);
    if (!binding.valid)
      return { valid: false, reason: binding.reason, blocked: true };
    if (
      processing &&
      (Number(row.config_version) !== binding.version ||
        Number(row.binding_version) !== Number(binding.binding!.version))
    )
      return { valid: false, reason: "接收人绑定或通知应用已变更。" };
    return { valid: true, reason: "", binding, item, prefs };
  }
  private async drain() {
    const now = this.now(),
      stamp = iso(now);
    const rows = this.repo.db
      .prepare(
        "SELECT * FROM notification_outbox WHERE state='pending' AND next_at<=? ORDER BY created_at LIMIT 200",
      )
      .all(stamp);
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const ws = String(row.workspace_id),
        userId = String(row.user_id),
        check = this.validDelivery(row);
      if (!check.valid) {
        this.repo.db
          .prepare(
            "UPDATE notification_outbox SET state=?,next_at=?,error=?,updated_at=? WHERE id=? AND state='pending'",
          )
          .run(
            check.until ? "pending" : check.blocked ? "blocked" : "cancelled",
            check.until ?? stamp,
            check.reason,
            stamp,
            String(row.id),
          );
        continue;
      }
      const prefs = check.prefs!,
        timeZone = this.repo.settings(ws).timeZone;
      let defer: string | undefined;
      if (prefs.delivery === "digest") {
        const next = this.nextClock(
          new Date(String(row.created_at)),
          prefs.digestTime,
          timeZone,
        );
        if (Date.parse(next) > now.getTime()) defer = next;
      }
      if (isNotificationQuietTime(now, timeZone, prefs))
        defer = this.nextClock(now, prefs.quietEnd, timeZone);
      const last = this.repo.db
        .prepare(
          "SELECT MAX(updated_at) AS last FROM notification_outbox WHERE workspace_id=? AND user_id=? AND state='accepted'",
        )
        .get(ws, userId)?.last;
      if (last && Date.parse(String(last)) + 120000 > now.getTime()) {
        const cooldown = new Date(
          Date.parse(String(last)) + 120000,
        ).toISOString();
        if (!defer || Date.parse(cooldown) > Date.parse(defer))
          defer = cooldown;
      }
      if (defer) {
        this.repo.db
          .prepare(
            "UPDATE notification_outbox SET next_at=?,error='等待摘要时间、安静时段结束或合并投递',updated_at=? WHERE id=? AND state='pending'",
          )
          .run(defer, stamp, String(row.id));
        continue;
      }
      const key = `${ws}:${userId}`;
      const group = groups.get(key) ?? [];
      if (group.length < 6) group.push(row);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (this.closed) break;
      const first = group[0]!,
        ws = String(first.workspace_id),
        userId = String(first.user_id);
      const binding = this.binding(ws, userId);
      if (!binding.valid || !binding.config) continue;
      const selected: typeof group = [];
      this.repo.transaction(() => {
        for (const row of group) {
          const check = this.validDelivery(row);
          if (!check.valid) continue;
          const result = this.repo.db
            .prepare(
              "UPDATE notification_outbox SET state='processing',attempts=attempts+1,config_version=?,binding_version=?,updated_at=? WHERE id=? AND state='pending'",
            )
            .run(
              binding.version,
              Number(binding.binding!.version),
              stamp,
              String(row.id),
            );
          if (result.changes)
            selected.push({
              ...row,
              config_version: binding.version,
              binding_version: binding.binding!.version,
            });
        }
      });
      if (!selected.length) continue;
      const composed = composeNotificationText(
        selected
          .map((row) => this.validDelivery(row, true).item)
          .filter((item): item is NotificationItem => !!item),
        binding.config.baseUrl,
      );
      for (let index = selected.length - 1; index >= 0; index--) {
        const row = selected[index]!;
        if (composed.ids.includes(String(row.notification_id))) continue;
        selected.splice(index, 1);
        this.repo.db
          .prepare(
            "UPDATE notification_outbox SET state='pending',attempts=attempts-1,next_at=? WHERE id=?",
          )
          .run(stamp, String(row.id));
      }
      if (!selected.length) continue;
      const result = await this.sender.send(
        binding.config,
        binding.version,
        binding.employee!.wecomUserId,
        composed.text,
        () =>
          !this.closed &&
          selected.every((row) => this.validDelivery(row, true).valid),
      );
      this.repo.transaction(() => {
        for (const row of selected) {
          const attempts = Number(row.attempts) + 1;
          const latest =
            result.state === "cancelled"
              ? this.validDelivery(row, true)
              : undefined;
          if (
            result.state === "cancelled" &&
            (this.closed || latest?.until || latest?.blocked)
          ) {
            this.repo.db
              .prepare(
                "UPDATE notification_outbox SET state=?,next_at=?,error=?,updated_at=? WHERE id=? AND state='processing'",
              )
              .run(
                latest?.blocked ? "blocked" : "pending",
                latest?.until ?? iso(this.now()),
                latest?.reason ?? "发送前服务已关闭，稍后继续。",
                iso(this.now()),
                String(row.id),
              );
            continue;
          }
          const retry =
            result.state === "failed" && result.retryable && attempts < 4;
          this.repo.db
            .prepare(
              "UPDATE notification_outbox SET state=?,error=?,external_id=?,next_at=?,updated_at=? WHERE id=? AND state='processing'",
            )
            .run(
              retry ? "pending" : result.state,
              result.error,
              result.messageId ?? null,
              retry
                ? new Date(
                    this.now().getTime() + 60000 * 2 ** (attempts - 1),
                  ).toISOString()
                : iso(this.now()),
              iso(this.now()),
              String(row.id),
            );
        }
      });
    }
  }
  reconcileAll() {
    for (const row of this.repo.db.prepare("SELECT id FROM workspaces").all())
      this.repo.transaction(() => this.reconcileWorkspace(String(row.id)));
  }
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) return this.running;
    this.running = (async () => {
      this.reconcileAll();
      await this.drain();
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  start() {
    this.repo.db
      .prepare(
        "UPDATE notification_outbox SET state='unknown',error='上次服务退出时投递尚未确认，停止自动重发',updated_at=? WHERE state='processing'",
      )
      .run(iso(this.now()));
    this.reconcileAll();
    const interval = this.options.intervalMs ?? 15000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          /* Durable pending state is retried on the next tick. */
        });
      }, interval);
      this.timer.unref();
    }
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  repo: Repository,
  actor: (req: FastifyRequest) => Actor,
  mutate: Mutate,
  service: NotificationService,
) {
  app.get("/api/notifications", (req) =>
    repo.transaction(() => {
      const a = actor(req);
      service.reconcileWorkspace(a.workspaceId);
      return service.state(a);
    }),
  );
  app.post("/api/notifications/action", (req) =>
    mutate(req, (a) => service.action(a, req.body)),
  );
  app.put("/api/notifications/preferences", (req) =>
    mutate(req, (a) => service.preferences(a, req.body)),
  );
  app.put("/api/notifications/following", (req) =>
    mutate(req, (a) => service.following(a, req.body)),
  );
  app.get("/api/notifications/:id/open", (req) =>
    service.open(
      actor(req),
      z.object({ id: z.string().max(200) }).parse(req.params).id,
    ),
  );
  app.get("/api/admin/notifications", (req) => service.adminState(actor(req)));
  app.put("/api/admin/notifications/config", (req) =>
    mutate(req, (a) => service.saveConfig(a, req.body)),
  );
  app.post("/api/admin/notifications/bindings", (req) =>
    mutate(req, (a) => service.confirmBindings(a, req.body)),
  );
  app.post("/api/admin/notifications/retry", (req) =>
    mutate(req, (a) => service.retry(a, req.body)),
  );
}
