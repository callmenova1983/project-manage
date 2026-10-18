import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { manualTaskOrder } from "../../packages/domain/task-move";
import { taskInput } from "../../packages/domain/types";
import { intakeCandidates } from "../../packages/domain/intake";
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("keeps local manual order across reload, ordinary edits, new tasks and snapshot export", async () => {
  const api = createLocalApi(),
    initial = await api.snapshot();
  const roots = initial.tasks.filter(
    (task) => task.projectId === initial.projects[0]!.id && !task.parentId,
  );
  const source = roots.at(-1)!,
    anchor = roots[0]!;
  await api.moveTask(source.id, {
    version: source.version,
    parentId: null,
    anchorId: anchor.id,
    anchorVersion: anchor.version,
    placement: "before",
  });
  const afterMove = await createLocalApi().snapshot();
  const current = afterMove.tasks.find((task) => task.id === source.id)!;
  const edited = await api.saveTask(
    { ...taskInput.strip().parse(current), title: "Retains moved order" },
    current.id,
    current.version,
  );
  expect(edited.sortOrder).toBe(current.sortOrder);
  const added = await api.saveTask({
    ...taskInput.strip().parse(current),
    title: "Appended task",
  });
  const exported = JSON.parse(JSON.stringify(await api.exportData()));
  const restored = await api.importData(exported, exported.revision);
  expect(restored.tasks.find((task) => task.id === current.id)!.sortOrder).toBe(
    current.sortOrder,
  );
  const ordered = manualTaskOrder(exported.tasks).filter(
    (task) => task.projectId === current.projectId && !task.parentId,
  );
  expect(ordered[0]!.id).toBe(source.id);
  expect(ordered.at(-1)!.id).toBe(added.id);
});
it("makes invalid or stale local subtree moves zero-write operations", async () => {
  const api = createLocalApi(),
    initial = await api.snapshot();
  const parent = initial.tasks.find((task) =>
    initial.tasks.some((child) => child.parentId === task.id),
  )!;
  const child = initial.tasks.find((task) => task.parentId === parent.id)!;
  const raw = [...storage];
  await expect(
    api.moveTask(parent.id, {
      version: parent.version,
      parentId: child.id,
      parentVersion: child.version,
      placement: "last",
    }),
  ).rejects.toThrow("Circular");
  expect([...storage]).toEqual(raw);
  await expect(
    api.moveTask(parent.id, {
      version: parent.version + 1,
      parentId: null,
      placement: "last",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect([...storage]).toEqual(raw);
  expect(await api.snapshot()).toEqual(initial);
});
it("keeps legacy intake receipts undoable after order migration while rejecting a real later move", async () => {
  const api = createLocalApi();
  await api.snapshot();
  const source = {
    kind: "text" as const,
    name: "legacy",
    sheet: "",
    text: "Project: Legacy intake; Client: Synthetic; Task: Review",
  };
  const batch = await api.applyIntake({
    source,
    confirmed: true,
    rows: intakeCandidates(source, []).map((candidate) => ({
      sourceRow: candidate.sourceRow,
      targetProjectId: "",
      targetProjectVersion: null,
      project: candidate.project,
      task: candidate.task,
      duplicateConfirmed: false,
    })),
  });
  const raw = JSON.parse(storage.get("project-manage-demo-v1")!);
  delete raw.intakes[0].tasks[0].sortOrder;
  const legacy = JSON.stringify(raw);
  storage.set("project-manage-demo-v1", legacy);
  await expect(createLocalApi().undoIntake(batch.id)).resolves.toMatchObject({
    state: "undone",
  });
  // Start again from the same old receipt, then make a real versioned move.
  storage.set("project-manage-demo-v1", legacy);
  const imported = (await api.snapshot()).tasks.find(
    (task) => task.id === batch.tasks[0]!.id,
  )!;
  const anchor = await api.saveTask({
    ...taskInput.strip().parse(imported),
    title: "Later sibling",
  });
  await api.moveTask(imported.id, {
    version: imported.version,
    parentId: null,
    anchorId: anchor.id,
    anchorVersion: anchor.version,
    placement: "after",
  });
  await expect(api.undoIntake(batch.id)).rejects.toThrow(
    "An imported task changed",
  );
});
