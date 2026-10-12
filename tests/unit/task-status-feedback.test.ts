import { beforeEach, it, expect, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createSeed } from "../../packages/domain/seed";
import {
  leafTasks,
  type Task,
  type TaskInput,
  type Snapshot,
} from "../../packages/domain/types";
import { summarizeWeeklyActivity } from "../../apps/web/src/composables/activity-summary";
const api = vi.hoisted(() => ({
  mode: "server",
  snapshot: vi.fn(),
  saveTask: vi.fn(),
  restore: vi.fn(),
  session: vi.fn(),
}));
vi.mock("../../apps/web/src/services/api", async () => ({
  api,
  ApiError: (await import("../../apps/web/src/services/contracts")).ApiError,
}));
import { ApiError } from "../../apps/web/src/services/contracts";
import { useWorkspace } from "../../apps/web/src/stores/workspace";
let snapshot: Snapshot;
let task: Task;
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  snapshot = createSeed();
  snapshot.activities = [];
  task = leafTasks(snapshot.tasks).find((task) => task.status === "blocked")!;
  api.snapshot.mockImplementation(async () => structuredClone(snapshot));
  api.session.mockResolvedValue({
    actor: {
      id: "synthetic",
      workspaceId: "synthetic",
      name: "Member",
      email: "synthetic@example.test",
    },
  });
  api.saveTask.mockImplementation(
    async (input: TaskInput, id: string, version: number) => {
      const before = snapshot.tasks.find((task) => task.id === id)!;
      if (before.version !== version) throw new ApiError("Conflict", 409);
      const after = {
        ...input,
        id,
        version: version + 1,
        updatedAt: new Date().toISOString(),
      };
      snapshot.tasks = snapshot.tasks.map((task) =>
        task.id === id ? after : task,
      );
      snapshot.activities.unshift({
        id: "saved-event",
        kind: "task",
        entityId: id,
        projectId: before.projectId,
        actor: "Member",
        action: "Updated task",
        source: "Task editor",
        createdAt: after.updatedAt,
        before,
        after,
      });
      snapshot.revision++;
      return after;
    },
  );
});
it("links acknowledged completion, real history and version-protected restoration", async () => {
  const store = useWorkspace();
  await store.initialize();
  const done = store.total.done;
  await store.changeTaskStatus(task, "done");
  expect(store.total.done).toBe(done + 1);
  expect(store.undoState).toBe("ready");
  expect(summarizeWeeklyActivity(store.data.activities).completionActions).toBe(
    1,
  );
  api.restore.mockImplementation(async (id: string, version: number) => {
    expect(id).toBe("saved-event");
    expect(version).toBe(task.version + 1);
    const before = snapshot.tasks.find((row) => row.id === task.id)!;
    const after = { ...task, version: version + 1 };
    snapshot.tasks = snapshot.tasks.map((row) =>
      row.id === task.id ? after : row,
    );
    snapshot.activities.unshift({
      ...snapshot.activities[0]!,
      id: "undo-event",
      source: "History restore",
      action: "Restored previous version",
      before,
      after,
    });
    return after;
  });
  await store.undoTaskStatus();
  await store.undoTaskStatus();
  expect(api.restore).toHaveBeenCalledTimes(1);
  expect(store.total.done).toBe(done);
  expect(store.taskFeedback?.undone).toBe(true);
  expect(store.data.tasks.find((row) => row.id === task.id)?.status).toBe(
    "blocked",
  );
  expect(summarizeWeeklyActivity(store.data.activities).completionActions).toBe(
    1,
  );
});
it("updates task summaries on acknowledgement but never invents unavailable history", async () => {
  const store = useWorkspace();
  await store.initialize();
  api.snapshot.mockRejectedValueOnce(new ApiError("Synthetic outage", 503));
  await store.changeTaskStatus(task, "done");
  expect(store.data.tasks.find((row) => row.id === task.id)?.status).toBe(
    "done",
  );
  expect(store.data.activities).toHaveLength(0);
  expect(store.undoState).toBe("sync");
  await store.undoTaskStatus();
  expect(api.restore).not.toHaveBeenCalled();
  await store.refresh();
  expect(store.undoState).toBe("ready");
});
it("blocks rapid repeated requests and task parents", async () => {
  const store = useWorkspace();
  await store.initialize();
  let resolve!: (task: Task) => void;
  api.saveTask.mockImplementationOnce(
    () =>
      new Promise<Task>((r) => {
        resolve = r;
      }),
  );
  const pending = store.changeTaskStatus(task, "done");
  await store.changeTaskStatus(task, "done");
  expect(api.saveTask).toHaveBeenCalledTimes(1);
  resolve({ ...task, status: "done", version: task.version + 1 });
  await pending;
  const parent = store.data.tasks.find((row) =>
    store.data.tasks.some((child) => child.parentId === row.id),
  )!;
  await expect(store.changeTaskStatus(parent, "done")).rejects.toThrow(
    "subtasks",
  );
  expect(api.saveTask).toHaveBeenCalledTimes(1);
});
it("does not undo over an observed later edit", async () => {
  const store = useWorkspace();
  await store.initialize();
  await store.changeTaskStatus(task, "done");
  snapshot.tasks = snapshot.tasks.map((row) =>
    row.id === task.id
      ? { ...row, title: "Another member's change", version: row.version + 1 }
      : row,
  );
  await store.refresh();
  expect(store.undoState).toBe("changed");
  await store.undoTaskStatus();
  expect(api.restore).not.toHaveBeenCalled();
});
it("handles an unobserved concurrent edit without retrying undo with a newer version", async () => {
  const store = useWorkspace();
  await store.initialize();
  await store.changeTaskStatus(task, "done");
  snapshot.tasks = snapshot.tasks.map((row) =>
    row.id === task.id
      ? { ...row, title: "Newer title", version: row.version + 1 }
      : row,
  );
  api.restore.mockRejectedValueOnce(new ApiError("Conflict", 409));
  await store.undoTaskStatus();
  expect(api.restore).toHaveBeenCalledWith("saved-event", task.version + 1);
  expect(store.undoState).toBe("changed");
  expect(store.taskFeedbackError).toContain("changed after");
  expect(store.data.tasks.find((row) => row.id === task.id)?.title).toBe(
    "Newer title",
  );
});
it("clears feedback and project navigation when the session changes", async () => {
  const store = useWorkspace();
  await store.initialize();
  await store.changeTaskStatus(task, "done");
  store.projectNavigation.query = "Private query";
  store.projectNavigation.expanded = task.projectId;
  await store.initialize();
  expect(store.taskFeedback).toBeNull();
  expect(store.projectNavigation.query).toBe("");
  expect(store.projectNavigation.expanded).toBe("");
});
it("ignores a pre-write snapshot that returns after the acknowledged status change", async () => {
  const store = useWorkspace();
  await store.initialize();
  const old = structuredClone(snapshot);
  let resolve!: (value: Snapshot) => void;
  api.snapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((r) => {
        resolve = r;
      }),
  );
  const pending = store.refresh(true);
  await store.changeTaskStatus(task, "done");
  resolve(old);
  await pending;
  expect(store.data.tasks.find((row) => row.id === task.id)?.status).toBe(
    "done",
  );
  expect(store.undoState).toBe("ready");
});
