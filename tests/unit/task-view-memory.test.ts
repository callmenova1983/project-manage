import { expect, it } from "vitest";
import { createTaskViewMemory } from "../../apps/web/src/services/task-view-memory";

it("retains layout presentation within one collection and resets live references on identity change", () => {
  const collection = createTaskViewMemory();
  const folds = collection.value("list:folds", () => new Set<string>());
  folds.value = new Set(["parent"]);
  expect(collection.value("list:folds", () => new Set<string>())).toBe(folds);
  expect([...folds.value]).toEqual(["parent"]);
  const gantt = collection.value("gantt:folds", () => new Set<string>());
  expect(gantt.value.size).toBe(0);
  const position = collection.value("gantt:scroll", () => ({
    left: 0,
    top: 0,
    saved: false,
  }));
  position.value = { left: 448, top: 200, saved: true };
  const otherCollection = createTaskViewMemory();
  expect(
    otherCollection.value("list:folds", () => new Set<string>()).value.size,
  ).toBe(0);
  collection.reset();
  expect(folds.value.size).toBe(0);
  expect(position.value).toEqual({ left: 0, top: 0, saved: false });
  expect(collection.value("list:folds", () => new Set<string>())).toBe(folds);
  folds.value = new Set(["new-parent"]);
  expect(gantt.value.size).toBe(0);
});
