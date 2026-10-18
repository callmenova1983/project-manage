import { describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  manualTaskOrder,
  normalizeTaskOrder,
  planTaskMove,
  TaskMoveConflict,
} from "../../packages/domain/task-move";
import {
  orderTaskTree,
  taskListGroups,
} from "../../packages/domain/task-list-view";
import type { Task } from "../../packages/domain/types";
const seed = createSeed(),
  project = seed.projects[0]!;
const task = (id: string, parentId: string | null = null): Task => ({
  ...seed.tasks[0]!,
  id,
  projectId: project.id,
  parentId,
  status: "todo",
  title: id,
  workDates: [],
  workWeek: null,
  dependencies: [],
  scheduleStart: null,
  scheduleEnd: null,
  milestone: false,
});
const apply = (tasks: Task[], changes: ReturnType<typeof planTaskMove>) =>
  tasks.map(
    (task) => changes.find(({ after }) => after.id === task.id)?.after ?? task,
  );
describe("atomic task placement", () => {
  it("moves siblings persistently without changing explicit title sorting", () => {
    const tasks = normalizeTaskOrder([task("a"), task("b"), task("c")]);
    const before = structuredClone(tasks);
    const changes = planTaskMove([project], tasks, "c", {
      version: 1,
      parentId: null,
      anchorId: "a",
      anchorVersion: 1,
      placement: "before",
    });
    const after = apply(tasks, changes);
    expect(manualTaskOrder(after).map((task) => task.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(
      taskListGroups(after, "none", "title")[0]!.tasks.map((task) => task.id),
    ).toEqual(["a", "b", "c"]);
    expect(tasks).toEqual(before);
    expect(new Set(changes.map(({ after }) => after.version))).toEqual(
      new Set([2]),
    );
  });
  it("moves an entire subtree and bumps the new parent version", () => {
    const tasks = normalizeTaskOrder([
      task("a"),
      task("child", "a"),
      task("grandchild", "child"),
      task("b"),
    ]);
    const after = apply(
      tasks,
      planTaskMove([project], tasks, "a", {
        version: 1,
        parentId: "b",
        parentVersion: 1,
        placement: "last",
      }),
    );
    expect(after.find((task) => task.id === "a")!.parentId).toBe("b");
    expect(after.find((task) => task.id === "b")!.version).toBe(2);
    expect(after.find((task) => task.id === "child")).toEqual(tasks[1]);
    expect(after.find((task) => task.id === "grandchild")).toEqual(tasks[2]);
    expect(
      orderTaskTree(manualTaskOrder(after)).map((task) => task.id),
    ).toEqual(["b", "a", "child", "grandchild"]);
  });
  it("preserves the legacy order across projects and sibling groups", () => {
    const tasks = [
      task("a"),
      task("child", "a"),
      task("other-project"),
      task("b"),
    ];
    tasks[2]!.projectId = "another-project";
    expect(manualTaskOrder(tasks).map((task) => task.id)).toEqual(
      tasks.map((task) => task.id),
    );
    expect(normalizeTaskOrder(tasks).map((task) => task.sortOrder)).toEqual([
      0, 0, 0, 1,
    ]);
  });
  it("rejects stale source, destination and anchor versions before producing changes", () => {
    const tasks = [task("a"), task("b")];
    for (const input of [
      { version: 2, parentId: null, placement: "last" as const },
      {
        version: 1,
        parentId: "b",
        parentVersion: 2,
        placement: "last" as const,
      },
      {
        version: 1,
        parentId: null,
        anchorId: "b",
        anchorVersion: 2,
        placement: "before" as const,
      },
    ])
      expect(() => planTaskMove([project], tasks, "a", input)).toThrow(
        TaskMoveConflict,
      );
  });
  it("rejects self/descendant parents, invalid anchors and cross-project moves", () => {
    const tasks = [
      task("a"),
      task("child", "a"),
      { ...task("foreign"), projectId: "other" },
    ];
    for (const parentId of ["a", "child", "foreign"])
      expect(() =>
        planTaskMove([project, { ...project, id: "other" }], tasks, "a", {
          version: 1,
          parentId,
          parentVersion: 1,
          placement: "last",
        }),
      ).toThrow();
    expect(() =>
      planTaskMove([project], tasks, "a", {
        version: 1,
        parentId: null,
        anchorId: "child",
        anchorVersion: 1,
        placement: "after",
      }),
    ).toThrow("anchor");
  });
  it("honors aggregate scheduling and leaf-only dependency invariants", () => {
    const scheduled = [
      task("a"),
      { ...task("b"), scheduleStart: "2026-10-19", scheduleEnd: "2026-10-20" },
    ];
    expect(() =>
      planTaskMove([project], scheduled, "a", {
        version: 1,
        parentId: "b",
        parentVersion: 1,
        placement: "last",
      }),
    ).toThrow("aggregate schedules");
    const dependent = [
      task("a"),
      task("b"),
      {
        ...task("c"),
        dependencies: [{ taskId: "b", type: "finish_to_start" as const }],
      },
    ];
    expect(() =>
      planTaskMove([project], dependent, "a", {
        version: 1,
        parentId: "b",
        parentVersion: 1,
        placement: "last",
      }),
    ).toThrow("leaf tasks");
  });
  it("validates the depth of all descendants, and leaves an unchanged placement alone", () => {
    const chain = Array.from({ length: 19 }, (_, index) =>
      task(`chain-${index}`, index ? `chain-${index - 1}` : null),
    );
    const tasks = [...chain, task("a"), task("child", "a")];
    expect(() =>
      planTaskMove([project], tasks, "a", {
        version: 1,
        parentId: "chain-18",
        parentVersion: 1,
        placement: "last",
      }),
    ).toThrow("20 levels");
    expect(
      planTaskMove([project], [task("a"), task("b")], "b", {
        version: 1,
        parentId: null,
        placement: "last",
      }),
    ).toEqual([]);
  });
});
