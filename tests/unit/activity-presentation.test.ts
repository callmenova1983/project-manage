import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import type { Activity, Project, Task } from "../../packages/domain/types";
import { presentActivity } from "../../apps/web/src/composables/activity-presentation";
import { setCatalogs } from "../../apps/web/src/composables/catalogs";
import { defaultCatalogs } from "../../packages/domain/admin";
import { locale } from "../../apps/web/src/locales";

const seed = createSeed(new Date("2026-10-11T12:00:00Z"));
const project: Project = { ...seed.projects[0]!, latestUpdate: "旧的项目动态" };
const task: Task = { ...seed.tasks[0]!, status: "todo", version: 1 };
function event(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "event-1",
    projectId: project.id,
    entityId: project.id,
    kind: "project",
    action: "Updated project",
    actor: "记录人",
    createdAt: "2026-10-11T12:00:00Z",
    source: "Manual edit",
    before: project,
    after: { ...project, version: 2 },
    ...overrides,
  };
}
function taskEvent(overrides: Partial<Activity> = {}): Activity {
  return event({
    kind: "task",
    entityId: task.id,
    projectId: task.projectId,
    action: "Updated task",
    before: task,
    after: { ...task, version: 2 },
    ...overrides,
  });
}

beforeEach(() => {
  locale.value = "en";
  setCatalogs();
});
afterEach(() => {
  locale.value = "en";
  setCatalogs();
});

describe("readable activity presentation", () => {
  it("shows schedule dates, milestone and predecessor titles without internal IDs", () => {
    const result = presentActivity(
      taskEvent({
        after: {
          ...task,
          scheduleStart: "2027-01-01",
          scheduleEnd: "2027-01-01",
          milestone: true,
          dependencies: [{ taskId: "private-edge-a", type: "finish_to_start" }],
        },
      }),
      { tasks: [{ id: "private-edge-a", title: "客户确认方案" }] },
    );
    expect(result.changes.map((change) => change.field)).toEqual([
      "Schedule start",
      "Schedule end",
      "Milestone",
      "Predecessor tasks",
    ]);
    expect(result.changes).toContainEqual({
      field: "Milestone",
      before: "No",
      after: "Yes",
    });
    expect(result.changes).toContainEqual({
      field: "Predecessor tasks",
      before: "—",
      after: "客户确认方案",
    });
    expect(JSON.stringify(result)).not.toContain("private-edge");
    const cleared = presentActivity(
      taskEvent({
        before: {
          ...task,
          milestone: true,
          dependencies: [{ taskId: "deleted-edge", type: "finish_to_start" }],
        },
        after: { ...task, milestone: false, dependencies: [] },
      }),
    );
    expect(cleared.changes).toContainEqual({
      field: "Milestone",
      before: "Yes",
      after: "No",
    });
    expect(cleared.changes).toContainEqual({
      field: "Predecessor tasks",
      before: "Previous task",
      after: "—",
    });
  });

  it("ignores empty planning defaults and dependency ordering while preserving unresolved edge changes", () => {
    expect(
      presentActivity(
        taskEvent({
          after: {
            ...task,
            scheduleStart: null,
            scheduleEnd: null,
            milestone: false,
            dependencies: [],
          },
        }),
      ).changes,
    ).toEqual([]);
    const a = {
      taskId: "unavailable-edge-a",
      type: "finish_to_start" as const,
    };
    const b = {
      taskId: "unavailable-edge-b",
      type: "finish_to_start" as const,
    };
    expect(
      presentActivity(
        taskEvent({
          before: { ...task, dependencies: [a, b] },
          after: { ...task, dependencies: [b, a] },
        }),
      ).changes,
    ).toEqual([]);
    expect(
      presentActivity(
        taskEvent({
          before: { ...task, dependencies: [a] },
          after: { ...task, dependencies: [b] },
        }),
      ).changes,
    ).toEqual([
      {
        field: "Predecessor tasks changed",
        before: "Previous task",
        after: "Previous task",
      },
    ]);
  });

  it("shows changed business values without repeating an unchanged report or audit fields", () => {
    const result = presentActivity(
      event({
        after: {
          ...project,
          owner: "新的负责人",
          version: 2,
          updatedAt: "2026-10-12T01:00:00Z",
          reportedBy: "另一位记录人",
        },
      }),
    );
    expect(result.label).toBe("Updated project");
    expect(result.subject).toBe(project.name);
    expect(result.changes).toEqual([
      { field: "Owner", before: project.owner, after: "新的负责人" },
    ]);
  });

  it("preserves the full saved report only when it actually changes", () => {
    const report = "客户原文\n".repeat(500);
    expect(
      presentActivity(event({ after: { ...project, latestUpdate: report } }))
        .changes,
    ).toEqual([
      {
        field: "Latest reported update",
        before: project.latestUpdate,
        after: report,
      },
    ]);
  });

  it("distinguishes task voiding and preserves the user's exact reason", () => {
    const reason = "Task updated\n因需求取消而作废";
    const result = presentActivity(
      taskEvent({
        action: "作废任务",
        source: reason,
        after: {
          ...task,
          version: 2,
          voided: {
            at: "2026-10-11T12:00:00Z",
            actor: "记录人",
            actorId: "member-1",
            reason,
            batchId: "batch-1",
          },
        },
      }),
    );
    expect(result).toMatchObject({
      label: "Task voided",
      tone: "danger",
      subject: task.title,
      reason,
      changes: [],
    });
  });

  it("separates lifecycle recovery from restoring an old version", () => {
    const voided: Task = {
      ...task,
      voided: {
        at: "2026-10-11T12:00:00Z",
        actor: "记录人",
        actorId: "member-1",
        reason: "原作废原因",
        batchId: "batch-1",
      },
    };
    expect(
      presentActivity(
        taskEvent({
          before: voided,
          after: { ...task, voided: null, version: 2 },
          source: "恢复误作废的任务",
        }),
      ),
    ).toMatchObject({
      label: "Voided task restored",
      tone: "restored",
      reason: "恢复误作废的任务",
    });
    expect(
      presentActivity(
        taskEvent({
          source: "History restore",
          after: { ...task, status: "done", version: 2 },
        }),
      ),
    ).toMatchObject({
      label: "Previous version restored",
      tone: "restored",
      reason: null,
    });
  });

  it("uses snapshots for deleted subjects and retains the saved removal action", () => {
    const removed = presentActivity(
      taskEvent({ action: "Undid intake", after: null }),
    );
    expect(removed.label).toBe("Undid intake");
    expect(removed.subject).toBe(task.title);
    expect(
      removed.changes.some((change) => change.field === "Task title"),
    ).toBe(false);
    expect(presentActivity(event({ after: null })).subject).toBe(project.name);
  });

  it("does not fabricate project field additions for a historical report without a before snapshot", () => {
    const result = presentActivity(
      event({ action: "Reported an update", before: null }),
    );
    expect(result.subject).toBe(project.name);
    expect(result.changes).toEqual([
      {
        field: "Latest reported update",
        before: "—",
        after: project.latestUpdate,
      },
    ]);
    expect(
      presentActivity(
        event({
          action: "Reported an update",
          before: null,
          after: { ...project, latestUpdate: "" },
        }),
      ).changes,
    ).toEqual([]);
  });

  it("prioritizes changed reports and task status in compact previews", () => {
    expect(
      presentActivity(
        event({
          after: {
            ...project,
            name: "新项目名称",
            latestUpdate: "本次项目动态",
          },
        }),
      ).changes.map((change) => change.field),
    ).toEqual(["Latest reported update", "Project name"]);
    expect(
      presentActivity(
        taskEvent({
          after: { ...task, title: "新的标题", status: "done", version: 2 },
        }),
      ).changes.map((change) => change.field),
    ).toEqual(["Status", "Task title"]);
  });

  it("avoids duplicate creation subjects while retaining business fields and later renames", () => {
    const created = presentActivity(
      event({ action: "Created project", before: null }),
    );
    expect(created.subject).toBe(project.name);
    expect(
      created.changes.some((change) => change.field === "Project name"),
    ).toBe(false);
    expect(created.changes.some((change) => change.field === "Stage")).toBe(
      true,
    );
    expect(
      presentActivity(
        event({
          action: "Renamed project",
          after: { ...project, name: "新名称" },
        }),
      ).changes,
    ).toEqual([
      { field: "Project name", before: project.name, after: "新名称" },
    ]);
    const taskCreated = presentActivity(taskEvent({ before: null }));
    expect(taskCreated.subject).toBe(task.title);
    expect(
      taskCreated.changes.some((change) => change.field === "Task title"),
    ).toBe(false);
  });

  it("displays clearing fields and false boolean values instead of dropping them", () => {
    const result = presentActivity(
      event({
        before: { ...project, intakeInbox: true, notes: "原笔记" },
        after: { ...project, intakeInbox: false, notes: "" },
      }),
    );
    expect(result.changes).toContainEqual({
      field: "Working notes",
      before: "原笔记",
      after: "—",
    });
    expect(result.changes).toContainEqual({
      field: "Intake inbox",
      before: "Yes",
      after: "No",
    });
  });

  it("formats task status and dates while preserving user-authored values", () => {
    locale.value = "zh-CN";
    const result = presentActivity(
      taskEvent({
        before: { ...task, assignee: "成员 A", dueDate: null },
        after: {
          ...task,
          version: 2,
          status: "done",
          assignee: "To do",
          dueDate: "2026-10-20",
        },
      }),
    );
    expect(result.tone).toBe("completed");
    expect(result.changes).toContainEqual({
      field: "Status",
      before: "待做",
      after: "已完成",
    });
    expect(result.changes).toContainEqual({
      field: "Assignee",
      before: "成员 A",
      after: "To do",
    });
    expect(
      result.changes.find((change) => change.field === "Due date"),
    ).toEqual({
      field: "Due date",
      before: "—",
      after: "2026年10月20日",
    });
  });

  it("resolves custom stages and categories through the current catalog", () => {
    setCatalogs({
      ...structuredClone(defaultCatalogs),
      stages: [
        ...defaultCatalogs.stages,
        {
          id: "review",
          en: "Customer review",
          zh: "客户审阅",
          order: 9,
          color: "neutral",
          archived: false,
        },
      ],
      categories: [
        {
          id: "public",
          en: "Public building",
          zh: "公共建筑",
          order: 0,
          color: "neutral",
          archived: false,
        },
      ],
    });
    locale.value = "zh-CN";
    const result = presentActivity(
      event({
        after: { ...project, stage: "review", categoryIds: ["public"] },
      }),
    );
    expect(
      result.changes.find((change) => change.field === "Stage")?.after,
    ).toBe("客户审阅");
    expect(
      result.changes.find((change) => change.field === "Categories")?.after,
    ).toBe("公共建筑");
  });

  it("ignores absent/empty optional fields and ordering-only set changes", () => {
    const result = presentActivity(
      event({
        before: { ...project, shortName: undefined, aliases: ["甲", "乙"] },
        after: { ...project, shortName: "", aliases: ["乙", "甲"] },
      }),
    );
    expect(result.changes).toEqual([]);
  });

  it("shows linked member identity changes even when the saved display name stays the same", () => {
    const members = [
      { id: "member-a", name: "同名成员", email: "a@example.test" },
      { id: "member-b", name: "同名成员", email: "b@example.test" },
    ];
    const changes = presentActivity(
      taskEvent({
        before: { ...task, assignee: "原保存姓名", assigneeId: "member-a" },
        after: { ...task, assignee: "原保存姓名", assigneeId: "member-b" },
      }),
      { members },
    ).changes;
    expect(changes).toEqual([
      {
        field: "Linked assignee",
        before: "同名成员 (a@example.test)",
        after: "同名成员 (b@example.test)",
      },
    ]);
    expect(
      presentActivity(
        event({
          before: { ...project, ownerId: "member-a" },
          after: { ...project, ownerId: "member-b" },
        }),
        { members },
      ).changes,
    ).toEqual([
      {
        field: "Linked owner",
        before: "同名成员 (a@example.test)",
        after: "同名成员 (b@example.test)",
      },
    ]);
  });

  it("preserves snapshot assignment text and avoids a second linked identity row for normal assignment", () => {
    const result = presentActivity(
      taskEvent({
        before: { ...task, assignee: "保存的旧姓名", assigneeId: "member-a" },
        after: { ...task, assignee: "保存的新姓名", assigneeId: "member-b" },
      }),
      {
        members: [
          { id: "member-a", name: "现今旧成员姓名", email: "a@example.test" },
          { id: "member-b", name: "现今新成员姓名", email: "b@example.test" },
        ],
      },
    );
    expect(result.changes).toEqual([
      { field: "Assignee", before: "保存的旧姓名", after: "保存的新姓名" },
    ]);
  });

  it("resolves hierarchy and project assignment without exposing identifiers", () => {
    const parent = { id: "parent-a", title: "原上级任务" };
    const nextParent = { id: "parent-b", title: "新上级任务" };
    const nextProject = { id: "project-b", name: "新所属项目" };
    const context = {
      tasks: [parent, nextParent],
      projects: [project, nextProject],
    };
    expect(
      presentActivity(
        taskEvent({
          before: { ...task, parentId: parent.id },
          after: { ...task, parentId: nextParent.id },
        }),
        context,
      ).changes,
    ).toEqual([
      { field: "Parent task", before: parent.title, after: nextParent.title },
    ]);
    expect(
      presentActivity(
        taskEvent({
          before: { ...task, projectId: project.id },
          after: { ...task, projectId: nextProject.id },
        }),
        context,
      ).changes,
    ).toEqual([
      {
        field: "Project assignment",
        before: project.name,
        after: nextProject.name,
      },
    ]);
  });

  it("shows participant-only changes while ignoring participant order", () => {
    const context = {
      members: [
        { id: "member-a", name: "甲", email: "" },
        { id: "member-b", name: "乙", email: "" },
      ],
    };
    expect(
      presentActivity(
        event({
          before: { ...project, participantIds: ["member-a"] },
          after: { ...project, participantIds: ["member-a", "member-b"] },
        }),
        context,
      ).changes,
    ).toEqual([
      { field: "Project participants", before: "甲", after: "甲、乙" },
    ]);
    expect(
      presentActivity(
        event({
          before: { ...project, participantIds: ["member-a", "member-b"] },
          after: { ...project, participantIds: ["member-b", "member-a"] },
        }),
        context,
      ).changes,
    ).toEqual([]);
  });

  it("labels unresolved identity changes explicitly while leaving raw IDs in raw history only", () => {
    const result = presentActivity(
      taskEvent({
        before: {
          ...task,
          assigneeId: "unavailable-member-a",
          parentId: "unavailable-parent-a",
          projectId: "unavailable-project-a",
        },
        after: {
          ...task,
          assigneeId: "unavailable-member-b",
          parentId: "unavailable-parent-b",
          projectId: "unavailable-project-b",
        },
      }),
    );
    expect(result.changes).toEqual([
      {
        field: "Linked assignee changed",
        before: "Member unavailable",
        after: "Member unavailable",
      },
      {
        field: "Project assignment changed",
        before: "Previous project",
        after: "Previous project",
      },
      {
        field: "Parent task changed",
        before: "Previous task",
        after: "Previous task",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("unavailable-");
    expect(
      presentActivity(
        event({
          before: { ...project, participantIds: ["old-member"] },
          after: { ...project, participantIds: ["new-member"] },
        }),
      ).changes,
    ).toEqual([
      {
        field: "Project participants changed",
        before: "Member unavailable",
        after: "Member unavailable",
      },
    ]);
  });

  it("keeps workspace events valid when neither snapshot exists", () => {
    expect(
      presentActivity(
        event({
          action: "Reordered projects",
          before: null,
          after: null,
          projectId: null,
        }),
      ),
    ).toMatchObject({
      label: "Reordered projects",
      subject: null,
      changes: [],
      reason: null,
    });
  });
});
