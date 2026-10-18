import { describe, expect, it } from "vitest";
import { multiViewFixture, multiViewContext } from "../fixtures/multi-view";
import {
  createTaskViewIndex,
  type TaskViewQuery,
} from "../../packages/domain/task-view";
import { taskListGroups } from "../../packages/domain/task-list-view";
import { taskBoardRows } from "../../packages/domain/task-board";
import {
  calendarBases,
  projectTaskCalendar,
} from "../../packages/domain/task-calendar";
import {
  taskGanttRows,
  visibleGanttRows,
} from "../../packages/domain/task-gantt";
import { projectTaskSchedules } from "../../packages/domain/task-schedule-projection";
import { projectPeopleWork } from "../../packages/domain/people-work";
import { projectWorkspaceOverview } from "../../packages/domain/project-view";
import {
  planTaskBulkUpdate,
  type TaskBulkUpdate,
} from "../../packages/domain/task-bulk-update";
import { validateGraph } from "../../packages/domain/types";
import { scheduleOverview } from "../../packages/domain/schedule-overview";

const all: TaskViewQuery = {
  scope: "all",
  status: "",
  project: "",
  query: "",
  focus: "all",
};
const ids = (tasks: readonly { id: string }[]) =>
  tasks.map((task) => task.id).sort();
const unique = (values: string[]) => [...new Set(values)].sort();
const cases: [string, Partial<TaskViewQuery>, string[]][] = [
  ["all", {}, ["a", "b", "c", "d", "e"]],
  ["today", { scope: "today" }, ["a", "c"]],
  ["week", { scope: "week" }, ["a", "b", "c"]],
  ["open", { focus: "open" }, ["a", "b", "d", "e"]],
  ["done", { focus: "done" }, ["c"]],
  ["blocked", { status: "blocked" }, ["d", "e"]],
  ["overdue", { risk: "overdue" }, ["a", "e"]],
  ["unplanned", { risk: "unplanned" }, ["d"]],
  ["linked identity", { assignee: "member:member-a" }, ["a"]],
  ["disabled linked identity", { assignee: "member:member-b" }, ["b"]],
  ["same-name text", { assignee: "text:王敏" }, ["c"]],
  ["me", { assignee: "me" }, ["a"]],
  ["unassigned", { assignee: "none" }, ["d"]],
  ["project", { project: "p2" }, ["d"]],
  ["project set", { projects: ["p1"], status: "blocked" }, ["e"]],
  ["empty project set", { projects: [] }, []],
  ["parent search", { query: "Parent" }, []],
];
describe("same-fixture multi-view task identity contract", () => {
  for (const [name, patch, expected] of cases)
    it(name, () => {
      const snapshot = multiViewFixture(),
        before = JSON.stringify(snapshot),
        query = { ...all, ...patch };
      const index = createTaskViewIndex(snapshot.tasks, {
        ...multiViewContext,
        members: snapshot.members,
      });
      const selected = index.select(query);
      expect(ids(selected)).toEqual(expected);
      for (const group of ["none", "project", "assignee", "status"] as const)
        expect(
          ids(
            taskListGroups(selected, group, "due").flatMap(
              (group) => group.tasks,
            ),
          ),
        ).toEqual(expected);
      expect(ids(Object.values(taskBoardRows(selected)).flat())).toEqual(
        expected,
      );
      const gantt = taskGanttRows(snapshot.tasks, new Set(expected));
      expect(
        ids(gantt.projection.matchedLeaves.map((row) => row.task)),
      ).toEqual(expected);
      expect(
        ids(gantt.rows.filter((row) => !row.aggregate).map((row) => row.task)),
      ).toEqual(expected);
      expect(
        ids(projectPeopleWork(snapshot, query, {}, multiViewContext).tasks),
      ).toEqual(expected);
      for (const basis of calendarBases) {
        const calendar = projectTaskCalendar(
          selected,
          basis,
          { start: "2026-09-01", end: "2026-12-01" },
          multiViewContext.timeZone,
        );
        const partition = [
          ...calendar.events.map((event) => event.taskId),
          ...calendar.missing.map((task) => task.id),
          ...calendar.undatedWeeks.flatMap((group) =>
            group.tasks.map((task) => task.id),
          ),
          ...calendar.outsideTaskIds,
        ];
        expect(unique(partition), basis).toEqual(expected);
        expect(
          calendar.visibleTaskCount +
            calendar.missing.length +
            calendar.undatedWeeks.reduce(
              (count, group) => count + group.tasks.length,
              0,
            ) +
            calendar.outsideTaskCount,
          basis,
        ).toBe(expected.length);
      }
      expect(JSON.stringify(snapshot)).toBe(before);
    });
});
it("keeps duplicate date events, undated weeks, outside windows and parent context separate", () => {
  const snapshot = multiViewFixture(),
    index = createTaskViewIndex(snapshot.tasks, multiViewContext),
    leaves = index.select(all);
  const work = projectTaskCalendar(
    [...leaves, leaves.find((task) => task.id === "a")!],
    "work",
    { start: "2026-10-19", end: "2026-10-26" },
    multiViewContext.timeZone,
  );
  expect(work.events.map((event) => event.taskId)).toEqual(["a", "c", "a"]);
  expect(work.visibleTaskCount).toBe(2);
  expect(ids(work.missing)).toEqual(["d"]);
  expect(
    work.undatedWeeks.map((group) => [group.week, group.inWindow]),
  ).toEqual([
    ["2026-10-12", false],
    ["2026-10-19", true],
  ]);
  const partial = projectTaskCalendar(
    leaves,
    "work",
    { start: "2026-10-19", end: "2026-10-20" },
    multiViewContext.timeZone,
  );
  expect(partial.outsideTaskIds).toEqual([]);
  expect(partial.visibleTaskCount).toBe(2);
  const due = projectTaskCalendar(
    leaves,
    "due",
    { start: "2026-10-19", end: "2026-10-26" },
    multiViewContext.timeZone,
  );
  expect(unique(due.events.map((event) => event.taskId))).toEqual(["c", "d"]);
  expect([...due.outsideTaskIds].sort()).toEqual(["a", "e"]);
  expect(ids(due.missing)).toEqual(["b"]);
  const schedule = projectTaskSchedules(
    snapshot.tasks,
    new Set(leaves.map((task) => task.id)),
    { start: "2026-10-19", end: "2026-10-25" },
  );
  expect(ids(schedule.inWindow.map((row) => row.task))).toEqual(["a"]);
  expect(ids(schedule.outsideWindow.map((row) => row.task))).toEqual([
    "b",
    "d",
  ]);
  expect(ids(schedule.unscheduled.map((row) => row.task))).toEqual(["c", "e"]);
  expect(schedule.summaries.get("root")).toMatchObject({
    start: "2026-10-20",
    end: "2026-10-22",
    incomplete: true,
    totalLeaves: 2,
  });
  const gantt = taskGanttRows(
    snapshot.tasks,
    new Set(leaves.map((task) => task.id)),
  );
  expect(
    ids(
      visibleGanttRows(gantt.rows, new Set(["root"]))
        .filter((row) => !row.aggregate)
        .map((row) => row.task),
    ),
  ).toEqual(["b", "d", "e"]);
  const people = projectPeopleWork(snapshot, all, {}, multiViewContext);
  expect(
    people.groups
      .find((group) => group.key === "member:member-a")
      ?.tasks.map((task) => task.id),
  ).toEqual(["a"]);
  expect(
    people.groups.find((group) => group.key === "member:member-b")?.canAssign,
  ).toBe(false);
  expect(
    people.groups
      .find((group) => group.key === "text:王敏")
      ?.tasks.map((task) => task.id),
  ).toEqual(["c"]);
  expect(people.counts.total).toBe(5);
});
it("matches overview work-scope sets and risk drill-down sets without promoting void-only parents", () => {
  const snapshot = multiViewFixture(),
    index = createTaskViewIndex(snapshot.tasks, multiViewContext);
  for (const scope of ["today", "week", "all"] as const) {
    const overview = projectWorkspaceOverview(snapshot, snapshot.projects, {
      ...multiViewContext,
      scope,
    });
    expect(ids(overview.tasks)).toEqual(ids(index.select({ ...all, scope })));
    expect(ids(overview.all.overdue)).toEqual(
      ids(index.select({ ...all, risk: "overdue" })),
    );
    expect(ids(overview.all.unplanned)).toEqual(
      ids(index.select({ ...all, risk: "unplanned" })),
    );
    expect(overview.all.total).toBe(5);
  }
});
it("keeps single-project summary, risk links and milestone details inside the selected project", () => {
  const snapshot = multiViewFixture();
  const before = structuredClone(snapshot);
  const index = createTaskViewIndex(snapshot.tasks, multiViewContext);
  for (const project of snapshot.projects) {
    const model = projectWorkspaceOverview(snapshot, [project], {
      ...multiViewContext,
      scope: "all",
    });
    expect(model.projectIds).toEqual([project.id]);
    expect(ids(model.tasks)).toEqual(
      project.id === "p1" ? ["a", "b", "c", "e"] : ["d"],
    );
    for (const [rows, patch] of [
      [model.all.open, { focus: "open" }],
      [model.all.done, { status: "done" }],
      [model.all.blocked, { status: "blocked" }],
      [model.all.overdue, { risk: "overdue" }],
      [model.all.unplanned, { risk: "unplanned" }],
    ] as const)
      expect(ids(rows)).toEqual(
        ids(index.select({ ...all, ...patch, project: project.id })),
      );
    const schedule = scheduleOverview(
      snapshot.tasks,
      new Set([project.id]),
      multiViewContext.now,
      multiViewContext.timeZone,
    );
    expect(
      [...schedule.upcoming, ...schedule.overdue].every(
        (task) => task.projectId === project.id,
      ),
    ).toBe(true);
    expect(
      schedule.warnings.every(
        (warning) =>
          warning.task.projectId === project.id &&
          warning.predecessor.projectId === project.id,
      ),
    ).toBe(true);
  }
  expect(snapshot).toEqual(before);
});
it("keeps independent date bases and identity groups consistent after acknowledged field changes", () => {
  const snapshot = multiViewFixture();
  const update = (id: string, change: TaskBulkUpdate["change"]) => {
    const task = snapshot.tasks.find((task) => task.id === id)!;
    const result = planTaskBulkUpdate(
      snapshot.tasks,
      snapshot.members ?? [],
      { targets: [{ id, version: task.version }], change },
      multiViewContext.now,
    );
    snapshot.tasks = snapshot.tasks.map(
      (task) => result.confirmed.find((saved) => saved.id === task.id) ?? task,
    );
    validateGraph(snapshot.projects, snapshot.tasks);
  };
  update("a", { field: "status", value: "done" });
  update("b", {
    field: "assignee",
    value: { assigneeId: null, assignee: "王敏" },
  });
  update("d", { field: "dueDate", value: "2026-10-10" });
  const query = { ...all, focus: "open" as const },
    index = createTaskViewIndex(snapshot.tasks, multiViewContext),
    selected = index.select(query);
  const expected = ["b", "d", "e"];
  expect(ids(selected)).toEqual(expected);
  expect(
    ids(
      taskListGroups(selected, "status", "due").flatMap((group) => group.tasks),
    ),
  ).toEqual(expected);
  expect(ids(Object.values(taskBoardRows(selected)).flat())).toEqual(expected);
  expect(
    ids(
      taskGanttRows(
        snapshot.tasks,
        new Set(expected),
      ).projection.matchedLeaves.map((row) => row.task),
    ),
  ).toEqual(expected);
  const people = projectPeopleWork(snapshot, query, {}, multiViewContext);
  expect(ids(people.tasks)).toEqual(expected);
  expect(
    ids(people.groups.find((group) => group.key === "text:王敏")!.tasks),
  ).toEqual(["b"]);
  expect(people.groups.some((group) => group.key === "member:member-b")).toBe(
    false,
  );
  const overview = projectWorkspaceOverview(snapshot, snapshot.projects, {
    ...multiViewContext,
    scope: "all",
  });
  expect(ids(overview.all.overdue)).toEqual(["d", "e"]);
  expect(snapshot.tasks.find((task) => task.id === "a")).toMatchObject({
    scheduleStart: "2026-10-20",
    scheduleEnd: "2026-10-22",
    dependencies: [{ taskId: "b", type: "finish_to_start" }],
  });
  expect(snapshot.tasks.find((task) => task.id === "d")).toMatchObject({
    workWeek: null,
    workDates: [],
    scheduleStart: "2026-11-05",
    scheduleEnd: "2026-11-06",
  });
  const milestones = scheduleOverview(
    snapshot.tasks,
    new Set(["p1", "p2"]),
    multiViewContext.now,
    multiViewContext.timeZone,
  );
  expect(ids(milestones.overdue)).toEqual(["b"]);
  expect(milestones.upcoming).toEqual([]);
});
