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
  copyTaskField: vi.fn(),
  saveProject: vi.fn(),
  saveTaskSchedule: vi.fn(),
  saveTaskScheduleBatch: vi.fn(),
  saveTaskDependencies: vi.fn(),
  bulkUpdateTasks: vi.fn(),
}));
vi.mock("../../apps/web/src/services/api", async () => ({
  api,
  ApiError: (await import("../../apps/web/src/services/contracts")).ApiError,
}));
import { ApiError } from "../../apps/web/src/services/contracts";
import { useWorkspace } from "../../apps/web/src/stores/workspace";
let snapshot: Snapshot;
let task: Task;
it("keeps confirmed bulk entities when the subsequent snapshot read fails", async () => {
  const store = useWorkspace();
  await store.initialize();
  const updated = { ...task, dueDate: "2027-01-01", version: task.version + 1 };
  api.bulkUpdateTasks.mockResolvedValueOnce([updated]);
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.bulkUpdateTasks({
    targets: [{ id: task.id, version: task.version }],
    change: { field: "dueDate", value: updated.dueDate },
  });
  expect(store.data.tasks.find((row) => row.id === task.id)).toMatchObject(
    updated,
  );
  expect(store.busy).toBe(false);
});
it("does not apply a late bulk acknowledgement to a newly initialized account", async () => {
  const store = useWorkspace();
  await store.initialize();
  let finish!: (tasks: Task[]) => void;
  api.bulkUpdateTasks.mockImplementationOnce(
    () =>
      new Promise<Task[]>((resolve) => {
        finish = resolve;
      }),
  );
  const saving = store.bulkUpdateTasks({
    targets: [{ id: task.id, version: task.version }],
    change: { field: "dueDate", value: "2027-01-01" },
  });
  api.session.mockResolvedValueOnce({
    actor: {
      id: "other-account",
      workspaceId: "other-workspace",
      name: "Other",
      email: "other@example.test",
    },
  });
  await store.initialize();
  finish([{ ...task, dueDate: "2027-01-01", version: task.version + 1 }]);
  await saving;
  expect(store.user?.id).toBe("other-account");
  expect(store.data.tasks.find((row) => row.id === task.id)).toEqual(task);
  expect(store.toast).toBe("");
});
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
it("keeps an assignment drag receipt and undoes only the version that was actually saved", async () => {
  const store = useWorkspace();
  await store.initialize();
  const source = leafTasks(snapshot.tasks)[0]!,
    target = leafTasks(snapshot.tasks).find(
      (t) => t.projectId !== source.projectId,
    )!;
  api.copyTaskField.mockImplementation(async (input) => {
    expect(input).toMatchObject({
      sourceId: source.id,
      sourceVersion: source.version,
      acrossProjects: true,
      overwriteConfirmed: true,
      targets: [{ id: target.id, version: target.version }],
    });
    const after = {
      ...target,
      assignee: source.assignee,
      assigneeId: source.assigneeId ?? null,
      version: target.version + 1,
    };
    snapshot.tasks = snapshot.tasks.map((t) =>
      t.id === target.id ? after : t,
    );
    snapshot.activities.unshift({
      id: "assignment-event",
      projectId: target.projectId,
      entityId: target.id,
      kind: "task",
      action: "Copied task assignee",
      actor: "Member",
      source: "Task field copy",
      createdAt: new Date().toISOString(),
      before: target,
      after,
    });
    return [after];
  });
  await store.copyTaskAssignee(
    source.id,
    source.version,
    target.id,
    target.version,
  );
  expect(store.taskFeedback).toMatchObject({
    kind: "assignee",
    previousAssignee: target.assignee,
    undone: false,
  });
  expect(store.undoState).toBe("ready");
  expect(store.data.tasks.find((t) => t.id === source.id)).toEqual(source);
  api.restore.mockImplementation(async (id, version) => {
    expect(id).toBe("assignment-event");
    expect(version).toBe(target.version + 1);
    const restored = { ...target, version: version + 1 };
    snapshot.tasks = snapshot.tasks.map((t) =>
      t.id === target.id ? restored : t,
    );
    return restored;
  });
  await store.undoTaskStatus();
  expect(store.data.tasks.find((t) => t.id === target.id)?.assignee).toBe(
    target.assignee,
  );
  expect(store.taskFeedback?.undone).toBe(true);
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
it("keeps acknowledged assignee and date edits when the following snapshot fails", async () => {
  const store = useWorkspace();
  await store.initialize();
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.saveTask(
    {
      ...task,
      assignee: "Explicit person",
      assigneeId: null,
      dueDate: "2026-11-10",
    },
    task,
  );
  expect(store.data.tasks.find((row) => row.id === task.id)).toMatchObject({
    assignee: "Explicit person",
    assigneeId: null,
    dueDate: "2026-11-10",
    version: task.version + 1,
  });
  expect(store.error).toBe("Read unavailable");
  expect(store.data.activities).toEqual([]);
});
it("keeps confirmed newly created tasks and project edits through a read outage", async () => {
  const store = useWorkspace();
  await store.initialize();
  const created = { ...task, id: "new-task", title: "New work" };
  api.saveTask.mockResolvedValueOnce(created);
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.saveTask(created);
  expect(store.data.tasks.filter((row) => row.id === created.id)).toHaveLength(
    1,
  );
  const project = store.data.projects[0]!;
  api.saveProject.mockResolvedValueOnce({
    ...project,
    owner: "New owner",
    version: project.version + 1,
  });
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.saveProject({ ...project, owner: "New owner" }, project);
  expect(store.data.projects.find((row) => row.id === project.id)?.owner).toBe(
    "New owner",
  );
});
it("does not let a previous session's late write refresh, notify or clear a new session's busy state", async () => {
  const store = useWorkspace();
  await store.initialize();
  let finish!: (value: Task) => void;
  api.saveTask.mockImplementationOnce(
    () =>
      new Promise<Task>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = store.saveTask(
    { ...task, assignee: "Old session write" },
    task,
  );
  await store.initialize();
  const reads = api.snapshot.mock.calls.length;
  store.busy = true;
  finish({ ...task, assignee: "Old session write", version: task.version + 1 });
  await pending;
  expect(api.snapshot.mock.calls.length).toBe(reads);
  expect(store.data.tasks.find((row) => row.id === task.id)?.assignee).not.toBe(
    "Old session write",
  );
  expect(store.toast).toBe("");
  expect(store.busy).toBe(true);
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

it("keeps confirmed single and batch schedule acknowledgements when snapshot refresh fails", async () => {
  const store = useWorkspace();
  await store.initialize();
  const scheduled = {
    ...task,
    scheduleStart: "2027-02-01",
    scheduleEnd: "2027-02-02",
    milestone: false,
    version: task.version + 1,
  };
  api.saveTaskSchedule.mockResolvedValueOnce(scheduled);
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.saveTaskSchedule(task, {
    scheduleStart: scheduled.scheduleStart,
    scheduleEnd: scheduled.scheduleEnd,
  });
  expect(api.saveTaskSchedule).toHaveBeenCalledWith(task.id, {
    version: task.version,
    scheduleStart: scheduled.scheduleStart,
    scheduleEnd: scheduled.scheduleEnd,
  });
  expect(store.data.tasks.find((row) => row.id === task.id)).toMatchObject(
    scheduled,
  );
  const other = leafTasks(snapshot.tasks).find((row) => row.id !== task.id)!;
  const updated = {
    ...other,
    scheduleStart: "2027-02-03",
    scheduleEnd: "2027-02-03",
    milestone: true,
    version: other.version + 1,
  };
  api.saveTaskScheduleBatch.mockResolvedValueOnce([scheduled, updated]);
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.saveTaskScheduleBatch({
    revision: store.data.revision,
    changes: [
      {
        id: updated.id,
        version: other.version,
        scheduleStart: updated.scheduleStart,
        scheduleEnd: updated.scheduleEnd,
        milestone: true,
      },
    ],
  });
  expect(store.data.tasks.find((row) => row.id === updated.id)).toMatchObject(
    updated,
  );
  const predecessor = leafTasks(snapshot.tasks).find(
    (row) => row.id !== task.id && row.projectId === task.projectId,
  )!;
  const dependencies = [
    { taskId: predecessor.id, type: "finish_to_start" as const },
  ];
  const linked = {
    ...scheduled,
    dependencies,
    version: scheduled.version + 1,
  };
  api.saveTaskDependencies.mockResolvedValueOnce(linked);
  api.snapshot.mockRejectedValueOnce(new ApiError("Read unavailable", 503));
  await store.saveTaskDependencies(scheduled, dependencies);
  expect(api.saveTaskDependencies).toHaveBeenCalledWith(task.id, {
    version: scheduled.version,
    dependencies,
  });
  expect(store.data.tasks.find((row) => row.id === task.id)).toMatchObject(
    linked,
  );
  expect(store.busy).toBe(false);
});
