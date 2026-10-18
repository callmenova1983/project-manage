import { z } from "zod";
import { DomainError, type Actor, type Task } from "./types.js";
export const taskLifecycleInput = z
  .object({
    version: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    action: z.enum(["void", "restore"]),
    reason: z.string().trim().max(500),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.action === "void" && !input.reason)
      ctx.addIssue({
        code: "custom",
        message: "请填写作废原因。",
        path: ["reason"],
      });
  });
export type TaskLifecycleInput = z.infer<typeof taskLifecycleInput>;
export class TaskLifecycleConflict extends Error {}
export function planTaskLifecycle(
  tasks: Task[],
  id: string,
  raw: TaskLifecycleInput,
  revision: number,
  actor: Actor,
  batchId: string,
) {
  const input = taskLifecycleInput.parse(raw),
    root = tasks.find((t) => t.id === id);
  if (!root || root.version !== input.version || revision !== input.revision)
    throw new TaskLifecycleConflict("任务已更新，请刷新后重新操作。");
  if (input.action === "void" && root.voided)
    throw new DomainError("任务已作废。");
  if (input.action === "restore" && !root.voided)
    throw new DomainError("任务尚未作废。");
  const ids = new Set([root.id]);
  if (input.action === "void") {
    for (let level = 0; level < 20; level++) {
      const children = tasks.filter(
        (t) => t.parentId && ids.has(t.parentId) && !ids.has(t.id),
      );
      if (!children.length) break;
      children.forEach((t) => ids.add(t.id));
    }
  } else {
    tasks
      .filter((t) => t.voided?.batchId === root.voided!.batchId)
      .forEach((t) => ids.add(t.id));
    if (
      tasks.some(
        (t) =>
          ids.has(t.id) &&
          t.parentId &&
          !ids.has(t.parentId) &&
          tasks.find((p) => p.id === t.parentId)?.voided,
      )
    )
      throw new DomainError("请先恢复上级任务。");
  }
  const at = new Date().toISOString();
  return tasks
    .filter(
      (t) =>
        ids.has(t.id) && (input.action === "void" ? !t.voided : !!t.voided),
    )
    .map((before) => ({
      before,
      after: {
        ...before,
        voided:
          input.action === "void"
            ? {
                at,
                actor: actor.name,
                actorId: actor.id,
                reason: input.reason,
                batchId,
              }
            : null,
        version: before.version + 1,
        updatedAt: at,
      } as Task,
    }));
}
