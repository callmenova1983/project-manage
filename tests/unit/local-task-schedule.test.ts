import { afterEach, expect, it, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { taskInput, type Task } from "../../packages/domain/types";
afterEach(() => vi.unstubAllGlobals());
it("keeps schedules through old local forms and legacy history while honoring explicit history clears", async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  const api = createLocalApi();
  const initial = await api.snapshot();
  const leaf = initial.tasks.find(
    (task) => !initial.tasks.some((child) => child.parentId === task.id),
  )!;
  const oldForm = taskInput.strip().parse(leaf);
  const scheduled = await api.saveTask(
    {
      ...oldForm,
      scheduleStart: "2026-12-28",
      scheduleEnd: "2027-01-10",
      milestone: false,
    },
    leaf.id,
    leaf.version,
  );
  const firstHistory = (await api.snapshot()).activities.find(
    (event) =>
      event.entityId === leaf.id && event.after?.version === scheduled.version,
  )!;
  expect(firstHistory.before).not.toHaveProperty("scheduleStart");
  const edited = await api.saveTask(
    { ...oldForm, title: "An old form edit" },
    leaf.id,
    scheduled.version,
  );
  expect(edited.scheduleEnd).toBe("2027-01-10");
  const restored = (await api.restore(firstHistory.id, edited.version)) as Task;
  expect(restored.scheduleStart).toBe("2026-12-28");
  const before = await api.snapshot();
  await expect(
    api.addTasks([
      { ...oldForm, parentId: leaf.id, title: "Invalid new child" },
    ]),
  ).rejects.toThrow("aggregate schedules");
  expect((await api.snapshot()).tasks).toEqual(before.tasks);
  expect((await api.snapshot()).revision).toBe(before.revision);
  const cleared = await api.saveTask(
    {
      ...taskInput.strip().parse(restored),
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
    },
    leaf.id,
    restored.version,
  );
  const milestone = await api.saveTask(
    {
      ...taskInput.strip().parse(cleared),
      scheduleStart: "2027-01-10",
      scheduleEnd: "2027-01-10",
      milestone: true,
    },
    leaf.id,
    cleared.version,
  );
  const history = (await api.snapshot()).activities.find(
    (event) =>
      event.entityId === leaf.id && event.after?.version === milestone.version,
  )!;
  const reverted = (await api.restore(history.id, milestone.version)) as Task;
  expect(reverted).toMatchObject({
    scheduleStart: null,
    scheduleEnd: null,
    milestone: false,
  });
  expect(
    (await createLocalApi().snapshot()).tasks.find(
      (task) => task.id === leaf.id,
    ),
  ).toMatchObject({ scheduleStart: null, scheduleEnd: null, milestone: false });
  const one = await api.saveTaskSchedule(reverted.id, {
    version: reverted.version,
    scheduleStart: "2027-02-01",
    scheduleEnd: "2027-02-02",
  });
  const batchBefore = await api.snapshot();
  const other = batchBefore.tasks.find(
    (task) =>
      task.id !== one.id &&
      !batchBefore.tasks.some((child) => child.parentId === task.id),
  )!;
  const changes = [
    {
      id: one.id,
      version: one.version,
      scheduleStart: one.scheduleStart,
      scheduleEnd: one.scheduleEnd,
    },
    {
      id: other.id,
      version: other.version,
      scheduleStart: "2027-02-05",
      scheduleEnd: "2027-02-05",
      milestone: true,
    },
  ];
  await expect(
    api.saveTaskScheduleBatch({
      revision: batchBefore.revision,
      changes: [changes[0]!, { ...changes[1]!, version: 999 }],
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await api.snapshot()).tasks).toEqual(batchBefore.tasks);
  expect((await api.snapshot()).revision).toBe(batchBefore.revision);
  const changed = await api.saveTaskScheduleBatch({
    revision: batchBefore.revision,
    changes,
  });
  expect(changed).toHaveLength(2);
  expect(changed[0]!.version).toBe(one.version);
  expect(changed[1]).toMatchObject({
    id: other.id,
    milestone: true,
    scheduleStart: "2027-02-05",
  });
  const dependencyBefore = await api.snapshot();
  const targets = dependencyBefore.tasks.filter(
    (task) =>
      task.projectId === one.projectId &&
      !dependencyBefore.tasks.some((child) => child.parentId === task.id),
  );
  const predecessor = targets[0]!,
    dependent = targets[1]!;
  const linked = await api.saveTaskDependencies(dependent.id, {
    version: dependent.version,
    dependencies: [{ taskId: predecessor.id, type: "finish_to_start" }],
  });
  expect(linked.dependencies).toEqual([
    { taskId: predecessor.id, type: "finish_to_start" },
  ]);
  expect(linked.dueDate).toBe(dependent.dueDate);
  const graphBefore = await api.snapshot();
  await expect(
    api.saveTaskDependencies(predecessor.id, {
      version: predecessor.version,
      dependencies: [{ taskId: dependent.id, type: "finish_to_start" }],
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect((await api.snapshot()).tasks).toEqual(graphBefore.tasks);
  const omitted = taskInput.strip().parse(linked);
  delete omitted.dependencies;
  const ordinary = await api.saveTask(
    { ...omitted, title: "A legacy title update" },
    linked.id,
    linked.version,
  );
  expect(ordinary.dependencies).toEqual(linked.dependencies);
  const removed = await api.saveTaskDependencies(ordinary.id, {
    version: ordinary.version,
    dependencies: [],
  });
  expect(removed.dependencies).toEqual([]);
  const linkedAgain = await api.saveTaskDependencies(removed.id, {
    version: removed.version,
    dependencies: linked.dependencies!,
  });
  const linkedHistory = (await api.snapshot()).activities.find(
    (event) =>
      event.entityId === removed.id &&
      event.after?.version === linkedAgain.version,
  )!;
  const restoredEmpty = (await api.restore(
    linkedHistory.id,
    linkedAgain.version,
  )) as Task;
  expect(restoredEmpty.dependencies).toEqual([]);
  const finalLinked = await api.saveTaskDependencies(restoredEmpty.id, {
    version: restoredEmpty.version,
    dependencies: linked.dependencies!,
  });
  const oldDependencyHistory = (await api.snapshot()).activities.find(
    (event) =>
      event.entityId === linked.id && event.after?.version === linked.version,
  )!;
  expect(oldDependencyHistory.before).not.toHaveProperty("dependencies");
  const restoredLegacy = (await api.restore(
    oldDependencyHistory.id,
    finalLinked.version,
  )) as Task;
  expect(restoredLegacy.dependencies).toEqual(linked.dependencies);
});
