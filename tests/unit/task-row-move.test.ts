import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createSeed } from "../../packages/domain/seed";
import {
  manualTaskOrder,
  normalizeTaskOrder,
  planTaskMove,
  type TaskMoveInput,
} from "../../packages/domain/task-move";
import type { Task } from "../../packages/domain/types";
import { ApiError } from "../../apps/web/src/services/contracts";
const store = vi.hoisted(() => ({
  data: { tasks: [] as Task[] },
  busy: false,
  moveTask: vi.fn(),
}));
vi.mock("../../apps/web/src/stores/workspace", () => ({
  useWorkspace: () => store,
}));
vi.mock("../../apps/web/src/locales", () => ({ t: (key: string) => key }));
vi.mock("../../apps/web/src/composables/unsaved", () => ({
  confirmDiscard: () => true,
}));
import { useTaskRowMove } from "../../apps/web/src/composables/task-row-move";
const seed = createSeed(),
  project = seed.projects[0]!;
const task = (id: string, parentId: string | null = null): Task => ({
  ...seed.tasks[0]!,
  id,
  title: id,
  projectId: project.id,
  parentId,
  status: "todo",
  workDates: [],
  workWeek: null,
});
const current = (id: string) =>
  store.data.tasks.find((task) => task.id === id)!;
const ids = () => manualTaskOrder(store.data.tasks).map((task) => task.id);
beforeEach(() => {
  store.data = reactive({
    tasks: normalizeTaskOrder([task("a"), task("b"), task("c")]),
  });
  store.busy = false;
  store.moveTask
    .mockReset()
    .mockImplementation(
      async (source: Task, input: Omit<TaskMoveInput, "version">) => {
        const changes = planTaskMove([project], store.data.tasks, source.id, {
          ...input,
          version: source.version,
        });
        const changed = new Map(changes.map(({ after }) => [after.id, after]));
        store.data.tasks = store.data.tasks.map(
          (task) => changed.get(task.id) ?? task,
        );
        return changes.map(({ after }) => after);
      },
    );
  vi.stubGlobal("document", {
    getElementById: () => null,
    querySelector: () => null,
  });
});
afterEach(() => vi.unstubAllGlobals());
it("moves through visible siblings while undo restores the exact full-list position", async () => {
  const moving = useTaskRowMove(
    () => true,
    vi.fn(),
    () => [current("a"), current("c")],
  );
  await moving.keyboard(current("a"), {
    key: "ArrowDown",
    altKey: true,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent);
  expect(ids()).toEqual(["b", "c", "a"]);
  expect(moving.undo.value).toMatchObject({
    id: "a",
    version: 2,
    anchorId: "b",
    anchorVersion: 2,
  });
  await moving.undoMove();
  expect(ids()).toEqual(["a", "b", "c"]);
  expect(store.moveTask.mock.calls[1]![1]).toMatchObject({
    anchorId: "b",
    anchorVersion: 2,
    placement: "before",
  });
});
it("uses acknowledged old-parent versions when undoing an entire subtree move", async () => {
  store.data.tasks = normalizeTaskOrder([
    task("p"),
    task("a", "p"),
    task("child", "a"),
    task("b", "p"),
    task("q"),
  ]);
  const moving = useTaskRowMove(() => true, vi.fn());
  await moving.move(current("a"), current("q"), "inside");
  expect(current("a").parentId).toBe("q");
  expect(current("child").parentId).toBe("a");
  expect(moving.undo.value).toMatchObject({
    id: "a",
    version: 2,
    parentId: "p",
    parentVersion: 2,
    anchorId: "b",
    anchorVersion: 1,
  });
  await moving.undoMove();
  expect(current("a").parentId).toBe("p");
  expect(current("child").parentId).toBe("a");
  expect(store.moveTask.mock.calls[1]![1]).toMatchObject({
    parentId: "p",
    parentVersion: 2,
  });
});
it.each(["source", "parent", "anchor", "missing-anchor"])(
  "refuses to overwrite later work when %s changed",
  async (changed) => {
    store.data.tasks = normalizeTaskOrder([
      task("p"),
      task("a", "p"),
      task("b", "p"),
      task("q"),
    ]);
    const moving = useTaskRowMove(() => true, vi.fn());
    await moving.move(current("a"), current("q"), "inside");
    if (changed === "missing-anchor")
      store.data.tasks = store.data.tasks.filter((task) => task.id !== "b");
    else
      current(changed === "source" ? "a" : changed === "parent" ? "p" : "b")
        .version++;
    const before = JSON.stringify(store.data.tasks);
    await moving.undoMove();
    expect(store.moveTask).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.data.tasks)).toBe(before);
    expect(moving.undo.value).toBeNull();
    expect(moving.error.value).toBe(
      "Task move undo is no longer available because tasks changed.",
    );
  },
);
it("handles a concurrent server conflict without retrying with newer versions", async () => {
  const moving = useTaskRowMove(() => true, vi.fn());
  await moving.move(current("c"), current("a"), "before");
  store.moveTask.mockRejectedValueOnce(
    new ApiError("Changed after snapshot", 409),
  );
  await moving.undoMove();
  expect(store.moveTask).toHaveBeenCalledTimes(2);
  expect(store.moveTask.mock.calls[1]![0].version).toBe(2);
  expect(moving.undo.value).toBeNull();
  expect(moving.error.value).toBe(
    "Task move undo is no longer available because tasks changed.",
  );
});
it("preserves the previous valid undo when a later placement is a no-op", async () => {
  const moving = useTaskRowMove(() => true, vi.fn());
  await moving.move(current("c"), current("a"), "before");
  const receipt = JSON.stringify(moving.undo.value),
    notice = moving.notice.value;
  await moving.move(current("c"), current("a"), "before");
  expect(JSON.stringify(moving.undo.value)).toBe(receipt);
  expect(moving.notice.value).toBe(notice);
  await moving.undoMove();
  expect(ids()).toEqual(["a", "b", "c"]);
});
it("uses the captured drop-target version when making a subtask", async () => {
  const moving = useTaskRowMove(() => true, vi.fn());
  const capturedDestination = { ...current("b") };
  current("b").version++;
  const before = JSON.stringify(store.data.tasks);
  await expect(
    moving.move(current("a"), capturedDestination, "inside"),
  ).resolves.toBe(false);
  expect(store.moveTask.mock.calls[0]![1]).toMatchObject({
    parentId: "b",
    parentVersion: capturedDestination.version,
  });
  expect(JSON.stringify(store.data.tasks)).toBe(before);
  expect(moving.undo.value).toBeNull();
});
