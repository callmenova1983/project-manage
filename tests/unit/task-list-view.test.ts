import { describe, expect, it } from "vitest";
import {
  orderTaskTree,
  taskListGroups,
} from "../../packages/domain/task-list-view";
import { createSeed } from "../../packages/domain/seed";
function tasks() {
  return createSeed()
    .tasks.slice(0, 4)
    .map((task, i) => ({
      ...task,
      id: `t${i}`,
      parentId: null,
      assigneeId: null,
      assignee: "",
    }));
}
describe("task list presentation", () => {
  it("groups each matched task once without conflating same-name accounts or mutating input", () => {
    const rows = tasks();
    Object.assign(rows[0]!, { assigneeId: "a", assignee: "王敏" });
    Object.assign(rows[1]!, { assigneeId: "b", assignee: "王敏" });
    rows[2]!.assignee = "王敏";
    const before = JSON.stringify(rows);
    expect(
      taskListGroups(rows, "assignee", "manual").map((group) => group.key),
    ).toEqual(["member:a", "member:b", "text:王敏", "none"]);
    for (const group of ["none", "project", "status", "assignee"] as const) {
      const groups = taskListGroups([...rows, rows[0]!], group, "title");
      expect(
        groups.flatMap((group) => group.tasks.map((task) => task.id)).sort(),
      ).toEqual(rows.map((task) => task.id).sort());
    }
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("sorts missing deadlines last and resolves ties by stable ID", () => {
    const rows = tasks();
    rows.forEach((task) => {
      task.dueDate = null;
      task.title = "same";
    });
    rows[2]!.dueDate = "2026-10-16";
    rows[1]!.dueDate = "2026-10-16";
    expect(
      taskListGroups([...rows].reverse(), "none", "due")[0]!.tasks.map(
        (task) => task.id,
      ),
    ).toEqual(["t1", "t2", "t0", "t3"]);
    expect(
      taskListGroups([...rows].reverse(), "none", "title")[0]!.tasks.map(
        (task) => task.id,
      ),
    ).toEqual(["t0", "t1", "t2", "t3"]);
  });
  it("traverses 5000 levels without recursion and terminates malformed cycles", () => {
    const base = tasks()[0]!;
    const deep = Array.from({ length: 5000 }, (_, i) => ({
      ...base,
      id: String(i),
      parentId: i ? String(i - 1) : null,
    }));
    expect(orderTaskTree([...deep].reverse()).map((task) => task.id)).toEqual(
      deep.map((task) => task.id),
    );
    const cycle = [
      { ...base, id: "a", parentId: "b" },
      { ...base, id: "b", parentId: "a" },
    ];
    expect(orderTaskTree(cycle).map((task) => task.id)).toEqual(["a", "b"]);
  });
});
