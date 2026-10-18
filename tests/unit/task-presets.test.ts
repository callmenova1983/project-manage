import { describe, expect, it } from "vitest";
import {
  taskPresetQuery,
  activeTaskPreset,
  taskPresets,
} from "../../apps/web/src/composables/task-presets";
import {
  readTaskFilters,
  readProjectTaskFilters,
} from "../../apps/web/src/composables/task-focus";
import { createTaskViewIndex } from "../../packages/domain/task-view";
import { createSeed } from "../../packages/domain/seed";
import type { Task } from "../../packages/domain/types";
const now = new Date("2026-10-16T12:00:00Z");
function fixture(): Task[] {
  const base = createSeed(now).tasks[0]!;
  return [
    {
      ...base,
      id: "mine",
      parentId: null,
      status: "todo",
      assigneeId: "a",
      assignee: "王敏",
      dueDate: null,
      workWeek: null,
      workDates: [],
    },
    {
      ...base,
      id: "namesake",
      parentId: null,
      status: "todo",
      assigneeId: "b",
      assignee: "王敏",
      dueDate: null,
      workWeek: null,
      workDates: [],
    },
    {
      ...base,
      id: "blocked",
      parentId: null,
      status: "blocked",
      assigneeId: null,
      assignee: "Assigned text",
      dueDate: "2026-10-15",
      workWeek: "2026-10-12",
      workDates: [],
    },
    {
      ...base,
      id: "unassigned",
      parentId: null,
      status: "todo",
      assigneeId: null,
      assignee: "",
      dueDate: null,
      estimatedDate: "2026-10-01",
      workWeek: null,
      workDates: [],
    },
    {
      ...base,
      id: "done",
      parentId: null,
      status: "done",
      assigneeId: "a",
      dueDate: "2026-10-01",
      workWeek: "2026-10-12",
      workDates: [],
    },
  ];
}
describe("common task presets", () => {
  it("replaces incompatible filters while retaining date presentation only", () => {
    const old = {
      view: "calendar",
      dateBasis: "work",
      date: "2026-10-16",
      calendarMode: "week",
      status: "done",
      q: "old",
      projects: ["foreign"],
      project: "foreign",
      assignee: "member:old",
      risk: "blocked",
      voided: "1",
      intake: "1",
    };
    for (const preset of taskPresets) {
      const query = taskPresetQuery(preset, old);
      expect(query).toMatchObject({
        view: "calendar",
        dateBasis: "work",
        calendarMode: "week",
        intake: "1",
      });
      for (const key of ["q", "projects", "project", "voided"])
        expect(query).not.toHaveProperty(key);
      expect(activeTaskPreset(readTaskFilters(query))).toBe(preset);
    }
  });
  it("matches explicit preset rules without confusing same-name accounts or estimated dates", () => {
    const tasks = fixture();
    const index = createTaskViewIndex(tasks, {
      now,
      timeZone: "UTC",
      actorId: "a",
    });
    const ids = (preset: (typeof taskPresets)[number]) =>
      index
        .select(readTaskFilters(taskPresetQuery(preset, {})))
        .map((task) => task.id);
    expect(ids("mine")).toEqual(["mine"]);
    expect(ids("coordination")).toEqual(["blocked"]);
    expect(ids("overdue")).toEqual(["blocked"]);
    expect(ids("unassigned")).toEqual(["unassigned"]);
    expect(
      createTaskViewIndex(tasks, { now }).select(
        readTaskFilters(taskPresetQuery("mine", {})),
      ),
    ).toEqual([]);
  });
  it("keeps project presets restricted to the route project and declines partial-rule matches", () => {
    const tasks = fixture();
    tasks[1]!.projectId = "foreign";
    const projectId = tasks[0]!.projectId;
    const query = taskPresetQuery("mine", { project: "foreign" });
    const scoped = readProjectTaskFilters(query, projectId);
    expect(activeTaskPreset(scoped, projectId)).toBe("mine");
    expect(
      createTaskViewIndex(tasks, { now, actorId: "b" }).select(scoped),
    ).toEqual([]);
    expect(
      activeTaskPreset({ ...scoped, query: "title" }, projectId),
    ).toBeUndefined();
    expect(
      activeTaskPreset({ ...scoped, projects: [] }, projectId),
    ).toBeUndefined();
  });
});
