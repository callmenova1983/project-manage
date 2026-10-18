import { describe, expect, it } from "vitest";
import {
  createTaskViewIndex,
  taskAssigneeKey,
  type TaskViewQuery,
} from "../../packages/domain/task-view";
import type { Task, Member } from "../../packages/domain/types";

const all: TaskViewQuery = {
  scope: "all",
  status: "",
  project: "",
  query: "",
  focus: "all",
};
const members: Member[] = [
  { id: "a", name: "王敏", email: "a@example.test", status: "active" },
  { id: "b", name: "王敏", email: "b@example.test", status: "disabled" },
];
function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "project",
    parentId: null,
    title: id,
    description: "",
    status: "todo",
    assignee: "",
    assigneeId: null,
    dueDate: null,
    workWeek: null,
    workDates: [],
    version: 1,
    updatedAt: "2026-10-18T12:00:00Z",
    ...patch,
  };
}
const voided = {
  at: "2026-10-18T12:00:00Z",
  actor: "A",
  actorId: "a",
  reason: "cancelled",
  batchId: "batch",
};
const context = {
  now: new Date("2026-10-18T16:05:00Z"),
  timeZone: "Asia/Shanghai",
  members,
  actorId: "a",
};

describe("shared task view projection", () => {
  it("keeps voided work within the same scope, project set, identity and risk filters", () => {
    const tasks = [
      task("parent", {
        voided,
        assigneeId: "a",
        workWeek: "2026-10-19",
        workDates: ["2026-10-19"],
        status: "blocked",
      }),
      task("child", {
        voided,
        parentId: "parent",
        assigneeId: "a",
        workWeek: "2026-10-19",
        workDates: ["2026-10-19"],
        status: "blocked",
      }),
      task("other", {
        voided,
        projectId: "other",
        assigneeId: "a",
        workWeek: "2026-10-19",
      }),
      task("old", { voided, assigneeId: "b", workWeek: "2026-10-12" }),
      task("active"),
    ];
    const before = JSON.stringify(tasks);
    const index = createTaskViewIndex(tasks, context);
    const query = {
      ...all,
      scope: "today" as const,
      projects: ["project"],
      assignee: "me",
      risk: "blocked",
      query: "cancelled",
    };
    expect(index.selectVoided(query).map((row) => row.id)).toEqual([
      "parent",
      "child",
    ]);
    expect(index.selectVoided({ ...query, projects: [] })).toEqual([]);
    expect(index.selectVoided({ ...query, assignee: "member:b" })).toEqual([]);
    expect(index.selectVoided({ ...query, status: "done" })).toEqual([]);
    expect(index.selectVoided({ ...all, query: "王敏" })).toHaveLength(4);
    expect(index.select(all).map((row) => row.id)).toEqual(["active"]);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("identifies leaves from the full graph before project, status and void filters", () => {
    const tasks = [
      task("root"),
      task("parent", { parentId: "root" }),
      task("child", { parentId: "parent", status: "blocked" }),
      task("other-parent"),
      task("cancelled", { parentId: "other-parent", voided }),
    ];
    const index = createTaskViewIndex(tasks, context);
    expect(index.select(all).map((t) => t.id)).toEqual(["child"]);
    const projection = index.project({ ...all, status: "blocked" });
    expect(projection.contextParents.map((t) => t.id)).toEqual([
      "root",
      "parent",
    ]);
    expect(projection.counts).toMatchObject({
      total: 1,
      open: 1,
      blocked: 1,
      todo: 0,
    });
    expect(
      index.project({ ...all, query: "other-parent" }).matchedLeafTasks,
    ).toEqual([]);
  });

  it("keeps identity stable across duplicate names, rename, disabled members and text assignments", () => {
    const tasks = [
      task("a-task", { assigneeId: "a", assignee: "Old name" }),
      task("b-task", { assigneeId: "b", assignee: "王敏" }),
      task("text", { assignee: "王敏" }),
      task("none"),
    ];
    const index = createTaskViewIndex(tasks, context);
    const ids = (assignee: string) =>
      index.select({ ...all, assignee }).map((t) => t.id);
    expect(ids("me")).toEqual(["a-task"]);
    expect(ids("member:b")).toEqual(["b-task"]);
    expect(ids("text:王敏")).toEqual(["text"]);
    expect(ids("none")).toEqual(["none"]);
    expect(ids("member:missing")).toEqual([]);
    expect(index.select({ ...all, query: "王敏" }).map((t) => t.id)).toEqual([
      "a-task",
      "b-task",
      "text",
    ]);
    expect(
      createTaskViewIndex(tasks).select({ ...all, assignee: "me" }),
    ).toEqual([]);
    expect(taskAssigneeKey(task("whitespace", { assignee: "  " }))).toBe(
      "none",
    );
  });

  it("uses workspace today and week without deriving work plans from due or estimated dates", () => {
    const tasks = [
      task("planned", {
        workWeek: "2026-10-19",
        workDates: ["2026-10-19", "2026-10-20"],
      }),
      task("deadline", { dueDate: "2026-10-19" }),
      task("old", { workWeek: "2026-10-12", workDates: ["2026-10-18"] }),
    ];
    const index = createTaskViewIndex(tasks, context);
    expect(index.today).toBe("2026-10-19");
    expect(index.week).toBe("2026-10-19");
    expect(index.select({ ...all, scope: "today" }).map((t) => t.id)).toEqual([
      "planned",
    ]);
    expect(index.select({ ...all, scope: "week" })).toHaveLength(1);
    expect(
      createTaskViewIndex(tasks, { ...context, timeZone: "UTC" })
        .select({ ...all, scope: "today" })
        .map((t) => t.id),
    ).toEqual(["old"]);
  });

  it("partitions statuses and exposes overlapping risk sets without inflating totals", () => {
    const tasks = [
      task("blocked", { status: "blocked", dueDate: "2026-10-18" }),
      task("done", { status: "done", dueDate: "2026-10-01" }),
      task("estimate", { estimatedDate: "2026-10-01" }),
      task("planned", {
        status: "in_progress",
        workWeek: "2026-10-19",
        assigneeId: "a",
      }),
    ];
    const index = createTaskViewIndex(tasks, context);
    const p = index.project(all);
    expect(p.counts).toEqual({
      total: 4,
      open: 3,
      todo: 1,
      in_progress: 1,
      blocked: 1,
      done: 1,
      overdue: 1,
      unplanned: 2,
      unassigned: 3,
    });
    expect(index.select({ ...all, risk: "overdue" }).map((t) => t.id)).toEqual([
      "blocked",
    ]);
    expect(index.select({ ...all, risk: "unknown" })).toEqual([]);
    expect(index.select({ ...all, risk: "unplanned", focus: "done" })).toEqual(
      [],
    );
    expect(p.risks.overdue[0]).toBe(p.risks.unplanned[0]);
  });

  it("does not mutate data and does not follow malformed ancestor cycles or cross-project parents", () => {
    const tasks = [
      task("parent", { parentId: "parent" }),
      task("child", { parentId: "parent" }),
      task("foreign", { projectId: "other" }),
      task("invalid-child", { parentId: "foreign" }),
    ];
    const before = JSON.stringify(tasks);
    const result = createTaskViewIndex(tasks, context).project(all);
    expect(result.contextParents.map((t) => t.id)).toEqual(["parent"]);
    expect(JSON.stringify(tasks)).toBe(before);
  });
});
