import type { Task } from "./types.js";

/** Stored edges include voided successors: they must remain valid after restore. */
export function taskPlanningImpact(tasks: readonly Task[], taskId: string) {
  const task = tasks.find((task) => task.id === taskId);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const outgoing = (task?.dependencies ?? []).map((edge) => ({
    task: task!,
    predecessor: byId.get(edge.taskId),
  }));
  const incoming = tasks.flatMap((successor) =>
    (successor.dependencies ?? [])
      .filter((edge) => edge.taskId === taskId)
      .map(() => ({ task: successor, predecessor: task })),
  );
  const hasSchedule = !!(
    task?.scheduleStart ||
    task?.scheduleEnd ||
    task?.milestone
  );
  return {
    task,
    hasSchedule,
    outgoing,
    incoming,
    edges: [...outgoing, ...incoming],
    blocksParent: hasSchedule || outgoing.length > 0 || incoming.length > 0,
    blocksProjectMove: outgoing.length > 0 || incoming.length > 0,
  };
}
