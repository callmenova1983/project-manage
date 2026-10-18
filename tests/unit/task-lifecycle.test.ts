import { it, expect, vi, afterEach } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import {
  taskSchema,
  statistics,
  snapshotImport,
  validateGraph,
} from "../../packages/domain/types";
import { createSeed } from "../../packages/domain/seed";
import { planTaskLifecycle } from "../../packages/domain/task-lifecycle";
import {
  filterTaskWork,
  readTaskFilters,
} from "../../apps/web/src/composables/task-focus";
afterEach(() => vi.unstubAllGlobals());
it("keeps local voided data across reload/export and restores the original work and history", async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
  });
  const api = createLocalApi(),
    before = await api.snapshot(),
    root = before.tasks.find((t) =>
      before.tasks.some((c) => c.parentId === t.id),
    )!;
  const changed = await api.taskLifecycle(root.id, {
    version: root.version,
    revision: before.revision,
    action: "void",
    reason: "重复录入",
  });
  const reopened = createLocalApi(),
    after = await reopened.snapshot();
  expect(after.tasks).toHaveLength(before.tasks.length);
  expect(changed.length).toBeGreaterThan(1);
  expect(statistics(after.tasks).total).toBeLessThan(
    statistics(before.tasks).total,
  );
  expect(
    filterTaskWork(after.tasks, readTaskFilters({ scope: "all" })).every(
      (t) => !t.voided,
    ),
  ).toBe(true);
  const exported = snapshotImport.parse(await reopened.exportData());
  expect(exported.tasks.find((t) => t.id === root.id)?.voided?.reason).toBe(
    "重复录入",
  );
  await reopened.taskLifecycle(root.id, {
    version: root.version + 1,
    revision: after.revision,
    action: "restore",
    reason: "",
  });
  const restored = await reopened.snapshot();
  expect(restored.tasks.every((t) => !t.voided)).toBe(true);
  expect(statistics(restored.tasks)).toEqual(statistics(before.tasks));
  expect(
    restored.activities.filter((a) => a.action === "作废任务"),
  ).toHaveLength(changed.length);
});
it("preserves separately voided children and prevents adding active children under a voided parent", () => {
  const seed = createSeed(),
    parent = seed.tasks.find((t) =>
      seed.tasks.some((c) => c.parentId === t.id),
    )!,
    child = seed.tasks.find((t) => t.parentId === parent.id)!;
  const actor = {
    id: "actor",
    name: "Member",
    workspaceId: "team",
    email: "member@example.test",
  };
  const apply = (
    rows: typeof seed.tasks,
    id: string,
    action: "void" | "restore",
    batch: string,
  ) => {
    const input = {
      version: rows.find((t) => t.id === id)!.version,
      revision: 1,
      action,
      reason: "误录",
    };
    const replacements = new Map(
      planTaskLifecycle(rows, id, input, 1, actor, batch).map((c) => [
        c.after.id,
        c.after,
      ]),
    );
    return rows.map((t) => replacements.get(t.id) ?? t);
  };
  let tasks = apply(seed.tasks, child.id, "void", "child-batch");
  tasks = apply(tasks, parent.id, "void", "parent-batch");
  expect(() =>
    validateGraph(seed.projects, [
      ...tasks,
      taskSchema.parse({ ...child, id: "new-child", voided: null }),
    ]),
  ).toThrow("先恢复");
  tasks = apply(tasks, parent.id, "restore", "unused");
  expect(tasks.find((t) => t.id === parent.id)?.voided).toBeNull();
  expect(tasks.find((t) => t.id === child.id)?.voided?.batchId).toBe(
    "child-batch",
  );
});
