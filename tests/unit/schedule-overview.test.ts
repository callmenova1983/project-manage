import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { scheduleOverview } from "../../packages/domain/schedule-overview";
it("uses workspace schedule dates, selected project IDs and a closed 30-day window", () => {
  const seed = createSeed();
  const leaf = seed.tasks.filter(
    (task) => !seed.tasks.some((child) => child.parentId === task.id),
  );
  const a = leaf[0]!,
    b = leaf.find(
      (task) => task.projectId === a.projectId && task.id !== a.id,
    )!;
  Object.assign(a, {
    milestone: true,
    status: "todo",
    scheduleStart: "2026-10-18",
    scheduleEnd: "2026-10-18",
    dueDate: "2030-01-01",
    workDates: [],
  });
  Object.assign(b, {
    milestone: true,
    status: "todo",
    scheduleStart: "2026-10-17",
    scheduleEnd: "2026-10-17",
  });
  const before = JSON.stringify(seed);
  const result = scheduleOverview(
    seed.tasks,
    new Set([a.projectId]),
    new Date("2026-10-17T16:30:00Z"),
    "Asia/Shanghai",
  );
  expect(result.today).toBe("2026-10-18");
  expect(result.end).toBe("2026-11-16");
  expect(result.upcoming.map((task) => task.id)).toEqual([a.id]);
  expect(result.overdue.map((task) => task.id)).toEqual([b.id]);
  expect(scheduleOverview(seed.tasks, new Set()).upcoming).toEqual([]);
  expect(JSON.stringify(seed)).toBe(before);
  const read = () =>
    scheduleOverview(
      seed.tasks,
      new Set([a.projectId]),
      new Date("2026-10-17T16:30:00Z"),
      "Asia/Shanghai",
    );
  a.scheduleStart = a.scheduleEnd = "2026-11-16";
  expect(read().upcoming.map((task) => task.id)).toEqual([a.id]);
  a.scheduleStart = a.scheduleEnd = "2026-11-17";
  expect(read().upcoming).toEqual([]);
  a.scheduleStart = a.scheduleEnd = "2026-10-18";
  a.status = "done";
  expect(read().upcoming).toEqual([]);
});
it("retains voided predecessors as actionable warnings and excludes completed successors", () => {
  const seed = createSeed();
  const leaves = seed.tasks.filter(
    (task) => !seed.tasks.some((child) => child.parentId === task.id),
  );
  const a = leaves[0]!,
    b = leaves.find(
      (task) => task.projectId === a.projectId && task.id !== a.id,
    )!;
  Object.assign(a, {
    status: "todo",
    dependencies: [{ taskId: b.id, type: "finish_to_start" }],
  });
  b.voided = {
    at: new Date().toISOString(),
    actor: "Synthetic",
    actorId: "synthetic",
    reason: "test",
    batchId: "batch",
  };
  expect(
    scheduleOverview(seed.tasks, new Set([a.projectId])).warnings,
  ).toMatchObject([
    {
      taskId: a.id,
      predecessorId: b.id,
      kind: "voided",
      predecessor: { title: b.title },
    },
  ]);
  a.status = "done";
  expect(scheduleOverview(seed.tasks, new Set([a.projectId])).warnings).toEqual(
    [],
  );
});
