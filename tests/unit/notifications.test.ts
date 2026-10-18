import { describe, expect, it } from "vitest";
import {
  defaultNotificationPreferences,
  deriveNotifications,
  deriveProjectNotifications,
  deriveTaskNotifications,
  isNotificationQuietTime,
  notificationCandidateSchema,
  notificationActionInput,
  notificationFollowingInput,
  notificationPreferencesInput,
  notificationResponseSchema,
} from "../../packages/domain/notifications.js";
import type { Project, Snapshot, Task } from "../../packages/domain/types.js";

const now = new Date("2026-10-16T08:00:00Z");
function project(id = "p", patch: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    owner: "负责人",
    ownerId: "owner",
    client: "",
    description: "",
    stage: "implementation",
    discipline: "Engineering",
    latestUpdate: "",
    notes: "",
    aliases: [],
    reportedAt: null,
    reportedBy: null,
    version: 1,
    updatedAt: "2026-10-15T08:00:00Z",
    ...patch,
  };
}
function task(id = "t", patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    projectId: "p",
    parentId: null,
    assignee: "王敏",
    assigneeId: "a",
    description: "",
    status: "todo",
    dueDate: null,
    estimatedDate: null,
    reminderAt: null,
    workWeek: null,
    workDates: [],
    version: 1,
    updatedAt: "2026-10-15T08:00:00Z",
    ...patch,
  };
}
function snapshot(
  tasks: Task[] = [],
  projects: Project[] = [project()],
): Snapshot {
  return {
    schemaVersion: 2,
    revision: 1,
    settings: { version: 1, timeZone: "Asia/Shanghai" },
    projects,
    tasks,
    activities: [],
    members: [
      { id: "a", name: "王敏", email: "a@example.test", status: "active" },
      { id: "b", name: "王敏", email: "b@example.test", status: "active" },
      {
        id: "owner",
        name: "负责人",
        email: "owner@example.test",
        status: "active",
      },
      {
        id: "admin",
        name: "管理员",
        email: "admin@example.test",
        status: "active",
      },
      {
        id: "disabled",
        name: "停用人员",
        email: "disabled@example.test",
        status: "disabled",
      },
    ],
  };
}
const voided = {
  at: "2026-10-15T08:00:00Z",
  actor: "管理员",
  actorId: "admin",
  reason: "误录",
  batchId: "batch",
};

describe("personal notification candidates", () => {
  it("aggregates overdue, coordination and an arrived reminder into one stable task", () => {
    const data = snapshot([
      task("t", {
        status: "blocked",
        dueDate: "2026-10-15",
        reminderAt: "2026-10-16T09:00:00+08:00",
      }),
    ]);
    const rows = deriveTaskNotifications(data, "a", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "task:t",
      kind: "task_risk",
      severity: "critical",
      tags: ["overdue", "coordination", "reminder"],
      reasons: ["截止日期已过（2026-10-15）", "需要协调", "提醒时间已到"],
      dueAt: "2026-10-15T16:00:00Z",
      taskId: "t",
      projectId: "p",
      actionable: true,
    });
    const changed = {
      ...data,
      revision: 2,
      tasks: [task("t", { status: "blocked", version: 9 })],
    };
    expect(deriveTaskNotifications(changed, "a", now)[0]?.key).toBe("task:t");
    expect(deriveTaskNotifications(changed, "a", now)[0]?.tags).toEqual([
      "coordination",
    ]);
  });

  it("uses the workspace calendar boundary and never flags today's deadline as overdue", () => {
    const data = snapshot([task("today", { dueDate: "2026-10-16" })]);
    expect(
      deriveTaskNotifications(
        data,
        "a",
        new Date("2026-10-16T15:59:59.999Z"),
      )[0],
    ).toMatchObject({
      severity: "warning",
      tags: ["deadline_near"],
      reasons: ["今日截止（2026-10-16）"],
    });
    expect(
      deriveTaskNotifications(data, "a", new Date("2026-10-16T16:00:00Z"))[0],
    ).toMatchObject({
      severity: "critical",
      dueAt: "2026-10-16T16:00:00Z",
    });
    data.settings!.timeZone = "UTC";
    expect(
      deriveTaskNotifications(data, "a", new Date("2026-10-16T16:00:00Z"))[0],
    ).toMatchObject({ severity: "warning", tags: ["deadline_near"] });
  });

  it("computes a deadline after a daylight saving transition using local midnight", () => {
    const data = snapshot([task("dst", { dueDate: "2026-11-01" })]);
    data.settings!.timeZone = "America/New_York";
    expect(
      deriveTaskNotifications(data, "a", new Date("2026-11-02T04:59:59Z"))[0],
    ).toMatchObject({ severity: "warning", tags: ["deadline_near"] });
    expect(
      deriveTaskNotifications(data, "a", new Date("2026-11-02T05:00:00Z"))[0]
        ?.dueAt,
    ).toBe("2026-11-02T05:00:00Z");
  });

  it("warns for today's and tomorrow's explicit deadlines, excludes later plans and groups all reasons", () => {
    const data = snapshot([
      task("today", { dueDate: "2026-10-16" }),
      task("tomorrow", {
        dueDate: "2026-10-17",
        status: "blocked",
        reminderAt: "2026-10-16T07:00:00Z",
      }),
      task("later", { dueDate: "2026-10-18" }),
      task("estimate", { estimatedDate: "2026-10-16", workWeek: "2026-10-12" }),
    ]);
    const rows = deriveTaskNotifications(data, "a", now);
    expect(rows.map((row) => row.taskId)).toEqual(["today", "tomorrow"]);
    expect(rows[1]).toMatchObject({
      severity: "warning",
      tags: ["deadline_near", "coordination", "reminder"],
      reasons: ["明日截止（2026-10-17）", "需要协调", "提醒时间已到"],
    });
    const midnight = deriveTaskNotifications(
      data,
      "a",
      new Date("2026-10-16T16:00:00Z"),
    );
    expect(midnight.find((row) => row.taskId === "today")).toMatchObject({
      key: "task:today",
      severity: "critical",
      tags: ["overdue"],
    });
    expect(midnight.find((row) => row.taskId === "later")).toMatchObject({
      severity: "warning",
      tags: ["deadline_near"],
    });
  });

  it("compares reminders as instants including offsets and only after the exact time", () => {
    const data = snapshot([
      task("remind", { reminderAt: "2026-10-16T18:00:00+08:00" }),
    ]);
    expect(
      deriveTaskNotifications(data, "a", new Date("2026-10-16T09:59:59Z")),
    ).toEqual([]);
    expect(
      deriveTaskNotifications(data, "a", new Date("2026-10-16T10:00:00Z"))[0],
    ).toMatchObject({
      severity: "warning",
      tags: ["reminder"],
      dueAt: "2026-10-16T18:00:00+08:00",
    });
  });

  it("does not infer reminders or deadlines from plans, estimates or old activity", () => {
    const data = snapshot([
      task("planned", {
        estimatedDate: "2026-01-01",
        workWeek: "2026-01-05",
        workDates: ["2026-01-05"],
      }),
    ]);
    data.activities = [
      {
        id: "historic",
        projectId: "p",
        entityId: "planned",
        kind: "task",
        action: "restored",
        actor: "王敏",
        actorId: "a",
        source: "import",
        createdAt: "2026-01-01T00:00:00Z",
        before: null,
        after: task("planned", { dueDate: "2026-01-01" }),
      },
    ];
    expect(deriveTaskNotifications(data, "a", now)).toEqual([]);
  });

  it("uses the full task graph to exclude parents even if children are completed or voided", () => {
    const data = snapshot([
      task("parent", { status: "blocked" }),
      task("done-child", { parentId: "parent", status: "done" }),
      task("other-parent", { status: "blocked" }),
      task("void-child", {
        parentId: "other-parent",
        status: "blocked",
        voided,
      }),
      task("active-leaf", { status: "blocked" }),
    ]);
    expect(
      deriveTaskNotifications(data, "a", now).map((row) => row.taskId),
    ).toEqual(["active-leaf"]);
  });

  it("excludes done, voided, inbox and orphan tasks", () => {
    const data = snapshot(
      [
        task("done", {
          status: "done",
          dueDate: "2026-01-01",
          reminderAt: "2026-01-01T00:00:00Z",
        }),
        task("void", { status: "blocked", voided }),
        task("inbox", { projectId: "inbox", status: "blocked" }),
        task("orphan", { projectId: "missing", status: "blocked" }),
      ],
      [project(), project("inbox", { intakeInbox: true })],
    );
    expect(deriveTaskNotifications(data, "a", now)).toEqual([]);
  });

  it("routes only to exact accounts with owner fallback and never matches duplicate display names", () => {
    const data = snapshot([
      task("mine", { status: "blocked", assigneeId: "a" }),
      task("same-name", { status: "blocked", assigneeId: "b" }),
      task("legacy", { status: "blocked", assigneeId: null }),
    ]);
    expect(
      deriveTaskNotifications(data, "a", now).map((row) => row.taskId),
    ).toEqual(["mine"]);
    expect(
      deriveTaskNotifications(data, "owner", now).map((row) => row.taskId),
    ).toEqual(["legacy"]);
    expect(deriveTaskNotifications(data, "王敏", now)).toEqual([]);
    expect(deriveTaskNotifications(data, "", now)).toEqual([]);
    data.members = undefined;
    expect(deriveTaskNotifications(data, "a", now)).toHaveLength(1);
  });

  it("does not notify disabled or unknown accounts or redirect another assignee's task to the owner", () => {
    const data = snapshot([
      task("assigned", { status: "blocked", assigneeId: "disabled" }),
    ]);
    expect(deriveTaskNotifications(data, "disabled", now)).toEqual([]);
    expect(deriveTaskNotifications(data, "missing", now)).toEqual([]);
    expect(deriveTaskNotifications(data, "owner", now)).toEqual([]);
  });

  it("returns neutral metadata only for related people and admins managing unowned projects", () => {
    const data = snapshot(
      [],
      [
        project("owned", { stage: "unclassified" }),
        project("unowned", { owner: "", ownerId: null, stage: "unclassified" }),
        project("participant", {
          stage: "unclassified",
          participantIds: ["a"],
        }),
        project("member", { stage: "unclassified" }),
        project("complete"),
        project("inbox", {
          intakeInbox: true,
          owner: "",
          ownerId: null,
          stage: "unclassified",
        }),
      ],
    );
    data.projectMembers = [
      {
        projectId: "member",
        userId: "a",
        name: "王敏",
        department: "技术部",
        position: "工程师",
        joinedAt: "2026-01-01T00:00:00Z",
        lastEditedAt: "2026-01-01T00:00:00Z",
      },
    ];
    expect(
      deriveProjectNotifications(data, "a", now).map((row) => row.projectId),
    ).toEqual(["participant", "member"]);
    expect(deriveProjectNotifications(data, "admin", now)).toEqual([]);
    expect(
      deriveProjectNotifications(data, "admin", now, { isAdmin: true }),
    ).toMatchObject([
      {
        key: "project:unowned:metadata",
        severity: "neutral",
        reasons: ["待补负责人", "待补阶段"],
        taskId: null,
      },
    ]);
    expect(
      deriveProjectNotifications(data, "owner", now).map(
        (row) => row.projectId,
      ),
    ).toEqual(["owned", "participant", "member"]);
  });

  it("ignores the optional customer field and does not mutate snapshots", () => {
    const data = snapshot([task("blocked", { status: "blocked" })]);
    const before = JSON.stringify(data);
    expect(deriveProjectNotifications(data, "owner", now)).toEqual([]);
    expect(deriveNotifications(data, "a", now)).toHaveLength(1);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("notification settings and input contracts", () => {
  it("retains stable source task IDs on batched messages with a bounded payload", () => {
    const candidate = deriveTaskNotifications(
      snapshot([task("t", { status: "blocked" })]),
      "a",
      now,
    )[0]!;
    expect(
      notificationCandidateSchema.parse({
        ...candidate,
        taskIds: ["first", "second"],
      }).taskIds,
    ).toEqual(["first", "second"]);
    expect(
      notificationCandidateSchema.safeParse({
        ...candidate,
        taskIds: Array.from({ length: 501 }, (_, index) => `task-${index}`),
      }).success,
    ).toBe(false);
  });

  it("validates preferences with concurrency version and real clock values", () => {
    expect(
      notificationPreferencesInput.parse(defaultNotificationPreferences),
    ).toEqual(defaultNotificationPreferences);
    for (const patch of [
      { quietStart: "24:00" },
      { quietEnd: "08:60" },
      { digestTime: "9:00" },
      { version: 0 },
      { delivery: "all" },
    ])
      expect(
        notificationPreferencesInput.safeParse({
          ...defaultNotificationPreferences,
          ...patch,
        }).success,
      ).toBe(false);
  });

  it("applies overnight quiet hours in the workspace timezone with an exclusive end", () => {
    expect(
      isNotificationQuietTime(
        new Date("2026-10-16T14:00:00Z"),
        "Asia/Shanghai",
        defaultNotificationPreferences,
      ),
    ).toBe(true);
    expect(
      isNotificationQuietTime(
        new Date("2026-10-17T00:00:00Z"),
        "Asia/Shanghai",
        defaultNotificationPreferences,
      ),
    ).toBe(false);
    expect(
      isNotificationQuietTime(
        new Date("2026-10-16T14:00:00Z"),
        "UTC",
        defaultNotificationPreferences,
      ),
    ).toBe(false);
    const daytime = {
      ...defaultNotificationPreferences,
      quietStart: "12:00",
      quietEnd: "13:00",
    };
    expect(
      isNotificationQuietTime(
        new Date("2026-10-16T04:30:00Z"),
        "Asia/Shanghai",
        daytime,
      ),
    ).toBe(true);
    expect(
      isNotificationQuietTime(now, "UTC", { ...daytime, quietEnd: "12:00" }),
    ).toBe(false);
  });

  it("rejects duplicate IDs and invalid snooze combinations", () => {
    expect(
      notificationActionInput.safeParse({ ids: ["a"], action: "read" }).success,
    ).toBe(true);
    expect(
      notificationActionInput.safeParse({
        ids: ["a"],
        action: "snooze",
        until: "2026-10-17T08:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      notificationActionInput.safeParse({ ids: ["a", "a"], action: "read" })
        .success,
    ).toBe(false);
    expect(
      notificationActionInput.safeParse({ ids: ["a"], action: "snooze" })
        .success,
    ).toBe(false);
    expect(
      notificationActionInput.safeParse({
        ids: ["a"],
        action: "read",
        until: "2026-10-17T08:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      notificationFollowingInput.safeParse({
        projectIds: ["p", "p"],
        mode: "replace",
      }).success,
    ).toBe(false);
    expect(
      notificationFollowingInput.safeParse({ projectIds: [], mode: "merge" })
        .success,
    ).toBe(true);
  });

  it("keeps delivery availability independent from read and action counts", () => {
    expect(
      notificationResponseSchema.safeParse({
        items: [],
        unreadCount: 0,
        pendingCount: 0,
        followingIds: [],
        preferences: defaultNotificationPreferences,
        timeZone: "Asia/Shanghai",
        asOf: now.toISOString(),
        deliveryStatus: {
          configured: false,
          bound: false,
          reason: "企业微信通知尚未配置",
        },
      }).success,
    ).toBe(true);
  });
});
