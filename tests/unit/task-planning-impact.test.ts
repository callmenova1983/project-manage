import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { taskPlanningImpact } from "../../packages/domain/task-planning-impact";
it("lists incoming and outgoing edges including voided successors without mutating data", () => {
  const tasks = createSeed().tasks;
  const leaves = tasks.filter(
    (task) => !tasks.some((child) => child.parentId === task.id),
  );
  const a = leaves[0]!,
    b = leaves.find(
      (task) => task.projectId === a.projectId && task.id !== a.id,
    )!,
    c = leaves.find(
      (task) =>
        task.projectId === a.projectId && task.id !== a.id && task.id !== b.id,
    )!;
  a.scheduleStart = a.scheduleEnd = "2027-01-01";
  a.dependencies = [{ taskId: b.id, type: "finish_to_start" }];
  c.dependencies = [{ taskId: a.id, type: "finish_to_start" }];
  c.voided = {
    at: new Date().toISOString(),
    actor: "Synthetic",
    reason: "test",
    actorId: "synthetic",
    batchId: "synthetic",
  };
  const before = JSON.stringify(tasks);
  const impact = taskPlanningImpact(tasks, a.id);
  expect(impact.hasSchedule).toBe(true);
  expect(impact.blocksParent).toBe(true);
  expect(impact.blocksProjectMove).toBe(true);
  expect(impact.outgoing.map((edge) => edge.predecessor?.id)).toEqual([b.id]);
  expect(impact.incoming.map((edge) => edge.task.id)).toEqual([c.id]);
  expect(JSON.stringify(tasks)).toBe(before);
  a.dependencies = [];
  c.dependencies = [];
  expect(taskPlanningImpact(tasks, a.id)).toMatchObject({
    blocksParent: true,
    blocksProjectMove: false,
  });
  a.scheduleStart = a.scheduleEnd = null;
  expect(taskPlanningImpact(tasks, a.id).blocksParent).toBe(false);
});
