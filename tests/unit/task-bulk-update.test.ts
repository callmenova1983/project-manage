import { afterEach, expect, it, vi } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  planTaskBulkUpdate,
  TaskBulkConflict,
} from "../../packages/domain/task-bulk-update";
import { createLocalApi } from "../../apps/web/src/services/local";

afterEach(() => vi.unstubAllGlobals());
it("plans one selected field, skips no-ops and explicitly clears linked identities", () => {
  const seed = createSeed();
  const leaves = seed.tasks
    .filter((task) => !seed.tasks.some((child) => child.parentId === task.id))
    .slice(0, 2);
  const members = [
    {
      id: "member",
      name: "Stable member",
      email: "synthetic@example.test",
      status: "active" as const,
    },
  ];
  const targets = leaves.map((task) => ({
    id: task.id,
    version: task.version,
  }));
  const before = JSON.stringify(seed);
  const result = planTaskBulkUpdate(seed.tasks, members, {
    targets,
    change: {
      field: "assignee",
      value: { assigneeId: "member", assignee: "Outdated label" },
    },
  });
  expect(result.changes).toHaveLength(2);
  for (const { before: old, after } of result.changes)
    expect(after).toMatchObject({
      ...old,
      assigneeId: "member",
      assignee: "Stable member",
      version: old.version + 1,
      updatedAt: after.updatedAt,
    });
  expect(JSON.stringify(seed)).toBe(before);
  const tasks = seed.tasks.map(
    (task) => result.confirmed.find((saved) => saved.id === task.id) ?? task,
  );
  const current = result.confirmed.map((task) => ({
    id: task.id,
    version: task.version,
  }));
  expect(
    planTaskBulkUpdate(tasks, members, {
      targets: current,
      change: {
        field: "assignee",
        value: { assigneeId: "member", assignee: "Stable member" },
      },
    }).changes,
  ).toEqual([]);
  expect(
    planTaskBulkUpdate(tasks, members, {
      targets: current,
      change: { field: "assignee", value: { assigneeId: null, assignee: "" } },
    }).confirmed.every(
      (task) => task.assigneeId === null && task.assignee === "",
    ),
  ).toBe(true);
  expect(
    planTaskBulkUpdate(tasks, members, {
      targets: current,
      change: {
        field: "assignee",
        value: { assigneeId: null, assignee: "Pure text" },
      },
    }).confirmed.every(
      (task) => task.assigneeId === null && task.assignee === "Pure text",
    ),
  ).toBe(true);
  expect(() =>
    planTaskBulkUpdate(
      tasks,
      [{ ...members[0]!, id: "disabled", status: "disabled" }],
      {
        targets: current,
        change: {
          field: "assignee",
          value: { assigneeId: "disabled", assignee: "" },
        },
      },
    ),
  ).toThrow(/active member/);
});
it("reports every workspace-local conflict and rejects duplicate targets", () => {
  const seed = createSeed(),
    parent = seed.tasks.find((task) =>
      seed.tasks.some((child) => child.parentId === task.id),
    )!,
    leaf = seed.tasks.find(
      (task) => !seed.tasks.some((child) => child.parentId === task.id),
    )!;
  const input = {
    targets: [
      { id: leaf.id, version: 999 },
      { id: parent.id, version: parent.version },
      { id: "foreign-id", version: 1 },
    ],
    change: { field: "dueDate" as const, value: null },
  };
  try {
    planTaskBulkUpdate(seed.tasks, [], input);
    throw new Error("Expected conflict");
  } catch (error) {
    expect(error).toBeInstanceOf(TaskBulkConflict);
    expect((error as TaskBulkConflict).conflicts).toEqual([
      {
        id: leaf.id,
        reason: "Task version changed.",
        currentVersion: leaf.version,
      },
      {
        id: parent.id,
        reason: "Choose leaf tasks only.",
        currentVersion: parent.version,
      },
      {
        id: "foreign-id",
        reason: "Task unavailable in this workspace.",
        currentVersion: null,
      },
    ]);
  }
  expect(() =>
    planTaskBulkUpdate(seed.tasks, [], {
      ...input,
      targets: [input.targets[0]!, input.targets[0]!],
    }),
  ).toThrow(/Choose each task/);
});
it("keeps local state atomic on conflicts, preserves planning and clears dates explicitly", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const api = createLocalApi(),
    snapshot = await api.snapshot();
  const leaves = snapshot.tasks
    .filter(
      (task) => !snapshot.tasks.some((child) => child.parentId === task.id),
    )
    .slice(0, 2);
  const scheduled = await api.saveTaskSchedule(leaves[0]!.id, {
    version: leaves[0]!.version,
    scheduleStart: "2027-01-01",
    scheduleEnd: "2027-01-02",
  });
  const targets = [
    { id: scheduled.id, version: scheduled.version },
    { id: leaves[1]!.id, version: leaves[1]!.version },
  ];
  const before = await api.snapshot();
  await expect(
    api.bulkUpdateTasks({
      targets: [targets[0]!, { ...targets[1]!, version: 999 }],
      change: { field: "dueDate", value: null },
    }),
  ).rejects.toMatchObject({
    status: 409,
    conflicts: [{ id: targets[1]!.id, currentVersion: targets[1]!.version }],
  });
  expect(await api.snapshot()).toEqual(before);
  const result = await api.bulkUpdateTasks({
    targets,
    change: { field: "dueDate", value: null },
  });
  expect(result.every((task) => task.dueDate === null)).toBe(true);
  expect(result[0]).toMatchObject({
    scheduleStart: "2027-01-01",
    scheduleEnd: "2027-01-02",
    workDates: scheduled.workDates,
  });
});
