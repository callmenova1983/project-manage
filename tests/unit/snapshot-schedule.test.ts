import { afterEach, expect, it, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { snapshotImport, validateGraph } from "../../packages/domain/types";
import { normalizeImportedTaskPlanning } from "../../packages/domain/snapshot-schedule";
import { importCatalogs, defaultCatalogs } from "../../packages/domain/admin";
import { createSeed } from "../../packages/domain/seed";

afterEach(() => vi.unstubAllGlobals());
it("exports version 3 and round-trips planning; legacy replacements clear it", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const api = createLocalApi();
  const initial = await api.snapshot();
  const leaf = initial.tasks.find(
    (t) => !initial.tasks.some((c) => c.parentId === t.id),
  )!;
  const scheduled = await api.saveTaskSchedule(leaf.id, {
    version: leaf.version,
    scheduleStart: "2027-01-01",
    scheduleEnd: "2027-01-01",
    milestone: true,
  });
  const predecessor = initial.tasks.find(
    (t) =>
      t.id !== leaf.id &&
      t.projectId === leaf.projectId &&
      !initial.tasks.some((c) => c.parentId === t.id),
  )!;
  const dependencies = [
    { taskId: predecessor.id, type: "finish_to_start" as const },
  ];
  await api.saveTaskDependencies(leaf.id, {
    version: scheduled.version,
    dependencies,
  });
  const exported = snapshotImport.parse(await api.exportData());
  expect(exported.schemaVersion).toBe(3);
  await api.importData(exported, (await api.snapshot()).revision);
  expect(
    (await api.snapshot()).tasks.find((t) => t.id === leaf.id),
  ).toMatchObject({
    scheduleStart: "2027-01-01",
    milestone: true,
    dependencies,
  });
  const beforeInvalid = await api.snapshot();
  const invalid = structuredClone(exported);
  invalid.tasks.find((t) => t.id === leaf.id)!.dependencies = [
    { taskId: "missing", type: "finish_to_start" },
  ];
  await expect(
    api.importData(invalid, beforeInvalid.revision),
  ).rejects.toThrow();
  expect(await api.snapshot()).toEqual(beforeInvalid);
  for (const schemaVersion of [1, 2] as const) {
    const legacy = { ...exported, schemaVersion };
    const normalized = normalizeImportedTaskPlanning(legacy);
    expect(normalized.tasks.find((t) => t.id === leaf.id)).toMatchObject({
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      dependencies: [],
    });
    expect(exported.tasks.find((t) => t.id === leaf.id)?.milestone).toBe(true);
    await api.importData(legacy, (await api.snapshot()).revision);
    expect(
      (await api.snapshot()).tasks.find((t) => t.id === leaf.id)?.scheduleStart,
    ).toBeNull();
  }
});
it("requires catalogs in versions 2 and 3 and rejects dangling version 3 dependencies", () => {
  for (const schemaVersion of [2, 3] as const)
    expect(() =>
      importCatalogs({ schemaVersion, projects: [] }, defaultCatalogs, true),
    ).toThrow(/require a catalog/);
  const seed = createSeed();
  const task = seed.tasks.find(
    (t) => !seed.tasks.some((c) => c.parentId === t.id),
  )!;
  task.dependencies = [
    { taskId: "missing-predecessor", type: "finish_to_start" },
  ];
  const input = normalizeImportedTaskPlanning({
    ...seed,
    schemaVersion: 3 as const,
  });
  expect(() => validateGraph(input.projects, input.tasks)).toThrow(
    /unavailable/,
  );
});
