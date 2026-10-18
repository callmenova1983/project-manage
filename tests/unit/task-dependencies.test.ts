import { describe, expect, it } from "vitest";
import {
  validateTaskDependencies,
  taskDependencyWarnings,
} from "../../packages/domain/task-dependencies";
import { createSeed } from "../../packages/domain/seed";
import type { Task } from "../../packages/domain/types";
import {
  verifyIntakeUndo,
  type IntakeBatch,
} from "../../packages/domain/intake";
function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    ...createSeed().tasks[0]!,
    id,
    parentId: null,
    dependencies: [],
    scheduleStart: null,
    scheduleEnd: null,
    ...patch,
  };
}
const edge = (taskId: string) => ({ taskId, type: "finish_to_start" as const });
describe("predecessor graph", () => {
  it("checks an intake deletion set against active and voided external references but allows internal edges", () => {
    const seed = createSeed();
    const predecessor = task("a"),
      dependent = task("b", { dependencies: [edge("a")] });
    const batch: IntakeBatch = {
      id: "batch",
      createdAt: "2026-10-16T00:00:00Z",
      actor: "Synthetic",
      source: {
        kind: "text",
        name: "synthetic.txt",
        sheet: "",
        text: "Synthetic",
      },
      projects: [],
      entries: [],
      tasks: [predecessor],
      state: "applied",
    };
    expect(() =>
      verifyIntakeUndo(batch, { ...seed, tasks: [predecessor, dependent] }),
    ).toThrow("outside this intake");
    const voided = {
      at: "2026-10-16T00:00:00Z",
      actor: "Synthetic",
      actorId: "actor",
      reason: "cancelled",
      batchId: "void",
    };
    expect(() =>
      verifyIntakeUndo(batch, {
        ...seed,
        tasks: [predecessor, { ...dependent, voided }],
      }),
    ).toThrow("outside this intake");
    expect(() =>
      verifyIntakeUndo(
        { ...batch, tasks: [predecessor, dependent] },
        { ...seed, tasks: [predecessor, dependent] },
      ),
    ).not.toThrow();
  });
  it("validates every stored node including voided tasks and rejects self, duplicate, absent and cross-project edges", () => {
    const before = task("a"),
      after = task("b", { dependencies: [edge("a")] });
    expect(() => validateTaskDependencies([before, after])).not.toThrow();
    for (const dependencies of [
      [edge("b")],
      [edge("missing")],
      [edge("a"), edge("a")],
    ])
      expect(() =>
        validateTaskDependencies([before, { ...after, dependencies }]),
      ).toThrow();
    expect(() =>
      validateTaskDependencies([{ ...before, projectId: "other" }, after]),
    ).toThrow("unavailable");
    const voided = {
      at: "2026-10-16T00:00:00Z",
      actor: "Synthetic",
      actorId: "actor",
      reason: "cancelled",
      batchId: "batch",
    };
    expect(() =>
      validateTaskDependencies([
        { ...before, dependencies: [edge("b")] },
        { ...after, voided },
      ]),
    ).toThrow("cycle");
  });
  it("rejects turning either end into a parent and detects long cycles without recursion", () => {
    const rows = [task("a"), task("b", { dependencies: [edge("a")] })];
    expect(() =>
      validateTaskDependencies([...rows, task("child", { parentId: "a" })]),
    ).toThrow("leaf");
    expect(() =>
      validateTaskDependencies([...rows, task("child", { parentId: "b" })]),
    ).toThrow("parent");
    const base = task("base");
    const chain = Array.from({ length: 5000 }, (_, index) => ({
      ...base,
      id: String(index),
      dependencies: index ? [edge(String(index - 1))] : [],
    }));
    expect(() => validateTaskDependencies(chain)).not.toThrow();
    chain[0]!.dependencies = [edge("4999")];
    expect(() => validateTaskDependencies(chain)).toThrow("cycle");
  });
  it("reports unscheduled, natural-day and voided-predecessor warnings without rescheduling anything", () => {
    const predecessor = task("a", {
      scheduleStart: "2026-12-31",
      scheduleEnd: "2026-12-31",
      milestone: true,
    });
    const dependent = task("b", {
      dependencies: [edge("a")],
      scheduleStart: "2026-12-31",
      scheduleEnd: "2027-01-02",
    });
    const rows = [predecessor, dependent],
      before = JSON.stringify(rows);
    expect(taskDependencyWarnings(rows)).toEqual([
      {
        taskId: "b",
        predecessorId: "a",
        kind: "date_conflict",
        earliestStart: "2027-01-01",
      },
    ]);
    expect(
      taskDependencyWarnings([
        predecessor,
        { ...dependent, scheduleStart: "2027-01-01" },
      ]),
    ).toEqual([]);
    expect(
      taskDependencyWarnings([
        predecessor,
        { ...dependent, scheduleStart: null, scheduleEnd: null },
      ])[0]?.kind,
    ).toBe("unscheduled");
    expect(
      taskDependencyWarnings([
        {
          ...predecessor,
          voided: {
            at: "2026-10-16T00:00:00Z",
            actor: "Synthetic",
            actorId: "actor",
            reason: "cancelled",
            batchId: "batch",
          },
        },
        dependent,
      ])[0]?.kind,
    ).toBe("voided");
    expect(JSON.stringify(rows)).toBe(before);
  });
});
