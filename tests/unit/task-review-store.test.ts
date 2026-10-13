import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { taskSchema, type Task } from "../../packages/domain/types";
const mocks = vi.hoisted(() => ({
  saveTask: vi.fn(),
  snapshot: vi.fn(),
  reviewTask: vi.fn(),
}));
vi.mock("../../apps/web/src/services/api", async () => {
  const { ApiError } = await import("../../apps/web/src/services/contracts");
  return { api: { ...mocks, mode: "server" }, ApiError };
});
import { useWorkspace } from "../../apps/web/src/stores/workspace";
const makeTask = (id = "task", version = 1): Task =>
  taskSchema.parse({
    id,
    version,
    updatedAt: new Date().toISOString(),
    projectId: "p",
    parentId: null,
    title: "下次沟通，估计十月底",
    description: "",
    status: "todo",
    assignee: "",
    dueDate: null,
    workDates: [],
    workWeek: null,
  });
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue({
    schemaVersion: 1,
    revision: 1,
    projects: [],
    tasks: [makeTask()],
    activities: [],
  });
  mocks.saveTask.mockResolvedValue(makeTask());
});
it("resolves saving and releases busy before AI finishes; AI failure preserves the task", async () => {
  let fail!: (error: Error) => void;
  mocks.reviewTask.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const store = useWorkspace();
  const saved = await store.saveTask(makeTask());
  expect(saved.id).toBe("task");
  expect(store.busy).toBe(false);
  expect(store.taskReviews.task?.status).toBe("pending");
  fail(new Error("offline"));
  await vi.waitFor(() => expect(store.taskReviews.task?.status).toBe("failed"));
  expect(store.data.tasks[0]?.title).toBe(saved.title);
});
it("discards late analysis after an edit and serializes rapid inputs", async () => {
  const resolve: ((value: unknown) => void)[] = [];
  mocks.reviewTask.mockImplementation(
    () => new Promise((done) => resolve.push(done)),
  );
  const store = useWorkspace();
  store.data.tasks = [makeTask(), makeTask("second")];
  store.queueTaskReview(makeTask());
  store.queueTaskReview(makeTask("second"));
  expect(mocks.reviewTask).toHaveBeenCalledTimes(1);
  store.data.tasks[0] = makeTask("task", 2);
  resolve[0]!({ taskId: "task", version: 1, questions: [] });
  await vi.waitFor(() => expect(mocks.reviewTask).toHaveBeenCalledTimes(2));
  expect(store.taskReviews.task?.result).toBeUndefined();
  resolve[1]!({ taskId: "second", version: 1, questions: [] });
  await vi.waitFor(() =>
    expect(store.taskReviews.second?.status).toBe("ready"),
  );
});
