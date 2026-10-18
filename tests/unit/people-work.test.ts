import { describe, expect, it } from "vitest";
import { emptyDirectory, type Employee } from "../../packages/domain/directory";
import {
  departmentTreeIds,
  projectPeopleWork,
} from "../../packages/domain/people-work";
import {
  assignmentChoices,
  searchPeople,
} from "../../packages/domain/people-search";
import type { Snapshot, Task } from "../../packages/domain/types";
import type { TaskViewQuery } from "../../packages/domain/task-view";

const all: TaskViewQuery = {
  scope: "all",
  status: "",
  project: "",
  query: "",
  focus: "all",
};
const context = {
  now: new Date("2026-10-18T16:05:00Z"),
  timeZone: "Asia/Shanghai",
  actorId: "a",
};
function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    projectId: "p",
    parentId: null,
    description: "",
    status: "todo",
    assignee: "",
    assigneeId: null,
    dueDate: null,
    workWeek: null,
    workDates: [],
    version: 1,
    updatedAt: "2026-10-16T00:00:00Z",
    ...patch,
  };
}
function employee(id: string, patch: Partial<Employee> = {}): Employee {
  return {
    id,
    name: "王敏",
    employeeNo: id,
    active: true,
    userId: null,
    email: "",
    wecomUserId: "",
    position: "",
    departmentIds: [],
    source: "manual",
    ...patch,
  };
}
function snapshot(tasks: Task[] = []): Snapshot {
  return {
    schemaVersion: 2,
    revision: 1,
    projects: [],
    tasks,
    activities: [],
    members: [
      { id: "a", name: "王敏", email: "a@example.test", status: "active" },
      { id: "b", name: "王敏", email: "b@example.test", status: "disabled" },
      { id: "c", name: "周宁", email: "c@example.test", status: "active" },
    ],
    directory: {
      ...emptyDirectory(),
      departments: [
        { id: "root", name: "工程部", parentId: null, wecomId: null },
        { id: "child", name: "实施组", parentId: "root", wecomId: null },
      ],
      employees: [
        employee("ea", { userId: "a", departmentIds: ["root", "child"] }),
        employee("eb", { userId: "b", departmentIds: ["child"] }),
        employee("ec"),
        employee("left", { active: false }),
      ],
    },
  };
}

describe("people work by explicit identity", () => {
  it("keeps same-name accounts, text-only work and unassigned work separate without losing totals", () => {
    const s = snapshot([
      task("a", { assigneeId: "a", assignee: "旧名字" }),
      task("b", { assigneeId: "b", assignee: "王敏" }),
      task("text", { assignee: "王敏" }),
      task("none"),
      task("legacy-none", { assignee: "Unassigned" }),
    ]);
    const result = projectPeopleWork(s, all, {}, context);
    expect(result.counts.total).toBe(5);
    expect(
      Object.fromEntries(
        result.groups.map((group) => [
          group.key,
          group.tasks.map((task) => task.id),
        ]),
      ),
    ).toEqual({
      "member:a": ["a"],
      "member:b": ["b"],
      "text:王敏": ["text"],
      none: ["none", "legacy-none"],
    });
    expect(result.groups.find((group) => group.key === "member:a")?.name).toBe(
      "王敏",
    );
    expect(
      result.groups.find((group) => group.key === "member:b")?.canAssign,
    ).toBe(false);
    expect(result.groups.some((group) => group.key === "employee:ec")).toBe(
      false,
    );
    const renamed = {
      ...s,
      members: s.members!.map((member) =>
        member.id === "a" ? { ...member, name: "新名字" } : member,
      ),
    };
    expect(
      projectPeopleWork(renamed, all, {}, context)
        .groups.find((group) => group.key === "member:a")
        ?.tasks.map((task) => task.id),
    ).toEqual(["a"]);
  });

  it("includes active people without tasks while marking unlinked employees as unknown", () => {
    const result = projectPeopleWork(
      snapshot(),
      all,
      { showAll: true },
      context,
    );
    expect(result.groups.map((group) => group.key).sort()).toEqual([
      "employee:ec",
      "member:a",
      "member:b",
      "member:c",
    ]);
    expect(
      result.groups.find((group) => group.key === "employee:ec"),
    ).toMatchObject({
      kind: "employee",
      canAssign: false,
      counts: { total: 0 },
    });
    const s = snapshot();
    s.directory!.employees[1]!.active = false;
    expect(
      projectPeopleWork(s, all, { showAll: true }, context).groups.some(
        (group) => group.key === "member:b",
      ),
    ).toBe(false);
  });

  it("counts one weekly task and three date occurrences, and separates undated work weeks", () => {
    const s = snapshot([
      task("three-days", {
        assigneeId: "a",
        workWeek: "2026-10-19",
        workDates: ["2026-10-19", "2026-10-20", "2026-10-21"],
      }),
      task("week-only", { assigneeId: "a", workWeek: "2026-10-19" }),
      task("past", { assigneeId: "a", workWeek: "2026-10-12" }),
      task("unscheduled", { assigneeId: "a" }),
    ]);
    const result = projectPeopleWork(s, { ...all, scope: "week" }, {}, context);
    expect(result.week).toBe("2026-10-19");
    expect(result.counts.total).toBe(2);
    expect(
      Object.values(result.groups[0]!.days)
        .flat()
        .map((task) => task.id),
    ).toEqual(["three-days", "three-days", "three-days"]);
    expect(result.groups[0]!.undatedWeeks.map((week) => week.week)).toEqual([
      "2026-10-19",
    ]);
    const full = projectPeopleWork(s, all, {}, context).groups[0]!;
    expect(full.undatedWeeks.map((week) => week.week)).toEqual([
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(full.unscheduled.map((task) => task.id)).toEqual(["unscheduled"]);
  });

  it("does not duplicate multi-department people or infer a department from a name", () => {
    const s = snapshot([
      task("a", { assigneeId: "a" }),
      task("b", { assigneeId: "b" }),
      task("text", { assignee: "王敏" }),
    ]);
    const result = projectPeopleWork(s, all, { department: "root" }, context);
    expect(result.tasks.map((task) => task.id).sort()).toEqual(["a", "b"]);
    expect(result.counts.total).toBe(2);
    expect([...departmentTreeIds(s.directory, "root")].sort()).toEqual([
      "child",
      "root",
    ]);
    expect(
      projectPeopleWork(s, all, { department: "missing" }, context).tasks,
    ).toEqual([]);
    expect(
      projectPeopleWork(s, all, { person: "member:missing" }, context).groups,
    ).toEqual([]);
    expect(
      projectPeopleWork(s, all, { search: "ea" }, context).tasks.map(
        (task) => task.id,
      ),
    ).toEqual(["a"]);
  });

  it("preserves the shared leaf, lifecycle, state and due-date semantics", () => {
    const s = snapshot([
      task("parent", { assigneeId: "a" }),
      task("child", {
        assigneeId: "b",
        parentId: "parent",
        status: "blocked",
        dueDate: "2026-10-18",
      }),
      task("done", { assigneeId: "a", status: "done", dueDate: "2026-10-01" }),
      task("estimated", { assigneeId: "a", estimatedDate: "2026-10-01" }),
      task("void", {
        assigneeId: "a",
        voided: {
          at: "2026-10-16T00:00:00Z",
          actor: "A",
          actorId: "a",
          reason: "cancelled",
          batchId: "batch",
        },
      }),
    ]);
    const before = JSON.stringify(s);
    const result = projectPeopleWork(s, all, {}, context);
    expect(result.counts).toEqual({
      total: 3,
      open: 2,
      done: 1,
      blocked: 1,
      overdue: 1,
      unplanned: 2,
    });
    expect(
      projectPeopleWork(s, { ...all, assignee: "me" }, {}, context)
        .tasks.map((task) => task.id)
        .sort(),
    ).toEqual(["done", "estimated"]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("identity-aware assignment choices", () => {
  it("offers separate same-name accounts and unlinked employees, with no name-based ID inference", () => {
    const s = snapshot();
    s.members![1]!.status = "active";
    const result = assignmentChoices(s);
    const sameName = result.filter((person) => person.name === "王敏");
    expect(sameName.map((person) => person.key).sort()).toEqual([
      "employee:ec",
      "member:a",
      "member:b",
    ]);
    expect(
      sameName.find((person) => person.key === "employee:ec")?.memberId,
    ).toBeUndefined();
    expect(
      searchPeople(result, "a@example.test").map((person) => person.memberId),
    ).toEqual(["a"]);
    expect(searchPeople(result, "ea").map((person) => person.memberId)).toEqual(
      ["a"],
    );
    expect(result.some((person) => person.key === "employee:left")).toBe(false);
  });
  it("retains inactive current assignments without permitting new inactive account choices", () => {
    const s = snapshot();
    expect(assignmentChoices(s).some((person) => person.memberId === "b")).toBe(
      false,
    );
    expect(
      assignmentChoices(s, undefined, "b").some(
        (person) => person.memberId === "b",
      ),
    ).toBe(true);
  });
});
