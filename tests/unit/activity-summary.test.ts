import { describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import type { Activity, Task } from "../../packages/domain/types";
import {
  describeActivity,
  isCompletionAction,
  summarizeWeeklyActivity,
} from "../../apps/web/src/composables/activity-summary";

const now = new Date("2026-10-11T23:59:59.999Z");
const seed = createSeed(now);
const project = seed.projects[0]!;
const task: Task = {
  ...seed.tasks.find((item) => item.parentId)!,
  status: "todo",
  version: 1,
};
const done: Task = { ...task, status: "done", version: 2 };
function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "event-1",
    projectId: project.id,
    entityId: task.id,
    kind: "task",
    action: "Updated task",
    actor: "Synthetic teammate",
    createdAt: "2026-10-07T15:10:00Z",
    source: "Manual edit",
    before: task,
    after: done,
    ...overrides,
  };
}

describe("weekly activity based on saved events", () => {
  it("uses Monday UTC inclusive and excludes the next week, invalid and future timestamps", () => {
    const result = summarizeWeeklyActivity(
      [
        activity({ id: "previous", createdAt: "2026-10-04T23:59:59.999Z" }),
        activity({ id: "monday", createdAt: "2026-10-05T00:00:00Z" }),
        activity({ id: "offset", createdAt: "2026-10-12T01:00:00+02:00" }),
        activity({ id: "sunday", createdAt: now.toISOString() }),
        activity({ id: "next", createdAt: "2026-10-12T00:00:00Z" }),
        activity({ id: "invalid", createdAt: "not a timestamp" }),
      ],
      { now },
    );
    expect(result.weekStart).toBe("2026-10-05");
    expect(result.events.map((event) => event.id)).toEqual([
      "sunday",
      "offset",
      "monday",
    ]);
    expect(result.days.map((day) => day.count)).toEqual([1, 0, 0, 0, 0, 0, 2]);
    expect(
      summarizeWeeklyActivity([activity()], {
        now: new Date("2026-10-07T15:09:59Z"),
      }).changeCount,
    ).toBe(0);
  });

  it("does not turn initial sample reports or project timestamps into actual changes", () => {
    const empty = summarizeWeeklyActivity(seed.activities, { now });
    expect(empty.changeCount).toBe(0);
    expect(empty.completionActions).toBe(0);
    expect(empty.projectCount).toBe(0);
    const real = activity({
      kind: "project",
      entityId: project.id,
      before: project,
      after: { ...project, reportedAt: "2020-01-01T00:00:00Z", version: 2 },
    });
    expect(summarizeWeeklyActivity([real], { now }).changeCount).toBe(1);
    expect(summarizeWeeklyActivity([], { now }).events).toEqual([]);
  });

  it("attributes project scope to the saved activity, including no-longer-present projects", () => {
    const events = [
      activity({ id: "known" }),
      activity({ id: "previous", projectId: "previous-project" }),
      activity({ id: "workspace", projectId: null, kind: "import" }),
    ];
    expect(summarizeWeeklyActivity(events, { now })).toMatchObject({
      changeCount: 3,
      projectCount: 2,
    });
    expect(
      summarizeWeeklyActivity(events, {
        now,
        projectIds: ["previous-project"],
      }).events.map((event) => event.id),
    ).toEqual(["previous"]);
    expect(
      summarizeWeeklyActivity(events, { now, projectIds: [] }).changeCount,
    ).toBe(0);
    expect(
      summarizeWeeklyActivity(events, {
        now,
        projectIds: [project.id, "previous-project"],
      }).changeCount,
    ).toBe(2);
  });

  it("deduplicates event IDs without mutating or sorting the input array", () => {
    const earlier = activity({ id: "same", createdAt: "2026-10-06T12:00:00Z" });
    const later = activity({ id: "same", createdAt: "2026-10-07T12:00:00Z" });
    const events = [earlier, later];
    const result = summarizeWeeklyActivity(events, { now });
    expect(result.events).toEqual([later]);
    expect(result.changeCount).toBe(1);
    expect(events).toEqual([earlier, later]);
  });

  it("includes older matching records beyond the recent snapshot window", () => {
    const recent = Array.from({ length: 500 }, (_, index) =>
      activity({
        id: `recent-${index}`,
        projectId: "other-project",
        createdAt: new Date(now.getTime() - index * 1000).toISOString(),
      }),
    );
    const oldScoped = activity({ id: "older-scoped" });
    const result = summarizeWeeklyActivity([...recent, oldScoped], {
      now,
      projectIds: [project.id],
    });
    expect(result.changeCount).toBe(1);
    expect(
      summarizeWeeklyActivity([...recent, oldScoped], { now }).changeCount,
    ).toBe(501);
  });
});

describe("completion actions", () => {
  it("compares before and after statuses even when the audit action says generic edit", () => {
    expect(isCompletionAction(activity())).toBe(true);
    expect(
      isCompletionAction(activity({ before: { ...task, status: "blocked" } })),
    ).toBe(true);
    expect(
      isCompletionAction(activity({ before: { ...task, status: "done" } })),
    ).toBe(false);
    expect(
      isCompletionAction(
        activity({ after: { ...done, status: "in_progress" } }),
      ),
    ).toBe(false);
  });

  it("does not count creation, import, restore, missing snapshots or stale transitions as completion", () => {
    for (const overrides of [
      { before: null },
      { after: null },
      { kind: "import" as const },
      { kind: "project" as const },
      { source: "History restore" },
      { action: "Restored previous version" },
      { after: { ...done, version: 1 } },
      { after: { ...done, id: "different-task" } },
      { before: { ...task, projectId: "different-project" } },
    ]) {
      expect(isCompletionAction(activity(overrides))).toBe(false);
    }
  });

  it("counts replayed versions once and a genuine reopen-then-complete as another action", () => {
    const events = [
      activity(),
      activity({ id: "retried-copy" }),
      activity({
        id: "reopened",
        before: done,
        after: { ...task, version: 3 },
      }),
      activity({
        id: "completed-again",
        before: { ...task, version: 3 },
        after: { ...done, version: 4 },
      }),
    ];
    const summary = summarizeWeeklyActivity(events, { now });
    expect(summary.changeCount).toBe(4);
    expect(summary.completionActions).toBe(2);
    expect(summary.projectCount).toBe(1);
  });

  it("reports actions rather than fabricating task or parent/leaf totals", () => {
    const summary = summarizeWeeklyActivity([activity()], { now });
    expect(summary).toMatchObject({ completionActions: 1, changeCount: 1 });
    expect(summary).not.toHaveProperty("completedTasks");
    expect(summary).not.toHaveProperty("completionPercentage");
  });
});

describe("compact activity descriptions", () => {
  it("preserves user text and distinguishes completion from an ordinary edit", () => {
    const title = "客户原文 — do not translate";
    expect(
      describeActivity(activity({ after: { ...done, title } })),
    ).toMatchObject({
      key: "Task marked done",
      tone: "completed",
      subject: title,
    });
    expect(
      describeActivity(
        activity({ before: done, after: { ...done, title, version: 3 } }),
      ).key,
    ).toBe("Task updated");
    expect(
      describeActivity(
        activity({ before: done, after: { ...task, version: 3 } }),
      ),
    ).toMatchObject({
      key: "Task status: {status}",
      params: { status: "To do" },
    });
  });

  it("describes stage movement and reported updates without copying the full report", () => {
    const base = activity({
      kind: "project",
      entityId: project.id,
      before: project,
    });
    expect(
      describeActivity({ ...base, after: { ...project, stage: "operations" } }),
    ).toMatchObject({
      key: "Stage changed: {stage}",
      params: { stage: "Operations" },
      subject: project.name,
    });
    expect(
      describeActivity({
        ...base,
        after: { ...project, latestUpdate: "A lengthy report" },
      }),
    ).toEqual({
      key: "Project update reported",
      tone: "project",
      subject: project.name,
    });
  });

  it("clearly labels imports and restored versions even if their snapshots look completed", () => {
    expect(describeActivity(activity({ source: "History restore" })).key).toBe(
      "Previous version restored",
    );
    expect(describeActivity(activity({ kind: "import" }))).toEqual({
      key: "Workspace imported",
      tone: "import",
      subject: null,
    });
  });
});
