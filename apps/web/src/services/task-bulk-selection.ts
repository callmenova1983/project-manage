import type { Task } from "../../../../packages/domain/types";
/** A page operation cannot widen to the full query or silently refresh captured versions. */
export function selectBulkPage(
  selected: readonly Task[],
  page: readonly Task[],
) {
  const byId = new Map(selected.map((task) => [task.id, task]));
  for (const task of page)
    if (!byId.has(task.id)) byId.set(task.id, { ...task });
  if (byId.size > 100) throw new Error("Select no more than 100 tasks.");
  return [...byId.values()];
}
