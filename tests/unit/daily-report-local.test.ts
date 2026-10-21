import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { localProposal } from "../fixtures/proposals";
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("applies a persisted report using explicit attribution and schedule metadata without reparsing its prose", async () => {
  const api = createLocalApi();
  const before = await api.snapshot();
  const project = before.projects[0]!;
  const proposal = await localProposal(api, "李明：下周检查", [
    {
      title: "下周检查",
      sourceText: "下周检查",
      action: "task",
      status: "todo",
      dailyReport: true,
      reporter: "李明",
      workDate: "2026-10-17",
      workWeek: "2026-10-19",
      selectedProjectId: project.id,
    },
  ]);
  await api.applyProposal(
    proposal,
    proposal.suggestions.map((item) => ({ ...item, confirmed: true })),
    { partial: true, updateMode: "append" },
  );
  const task = (await createLocalApi().snapshot()).tasks.find(
    (task) => !before.tasks.some((old) => old.id === task.id),
  )!;
  expect(task).toMatchObject({
    assignee: "李明",
    workWeek: "2026-10-19",
    dueDate: null,
  });
});
