import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { meetingResults } from "../../apps/web/src/services/capture-results";
import { progressHistory } from "../../packages/domain/progress";
import type { Proposal } from "../../packages/domain/types";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

function review(proposal: Proposal) {
  return proposal.suggestions.map((s) => ({
    id: s.id,
    selectedProjectId: s.selectedProjectId,
    title: s.title,
    action: s.action,
    status: s.status,
    confirmed: true,
    overwriteConfirmed: false,
  }));
}

it("stores mixed reports with their own author and carries the attribution into visible receipts after reload", async () => {
  const api = createLocalApi();
  const before = await api.snapshot();
  const project = before.projects[0]!;
  const source = `李明\nReport to:王华\n日期：2026-10-17\n今日工作总结\n1. ${project.name} 更新浏览器，下周预计更换电脑\n2. ${project.name} 沟通设备清单`;
  const proposal = await api.propose(source);
  expect(proposal.suggestions.map((s) => s.action)).toEqual([
    "update",
    "task",
    "update",
  ]);
  expect(proposal.suggestions.every((s) => s.reporter === "李明")).toBe(true);
  const applied = await api.applyProposal(proposal, review(proposal), {
    partial: true,
    updateMode: "append",
  });
  const after = await createLocalApi().snapshot();
  const task = after.tasks.find(
    (t) => !before.tasks.some((old) => old.id === t.id),
  )!;
  expect(after.tasks).toHaveLength(before.tasks.length + 1);
  expect(task).toMatchObject({
    assignee: "李明",
    title: "下周预计更换电脑",
    status: "todo",
    workWeek: "2026-10-19",
    dueDate: null,
  });
  const updated = after.projects.find((p) => p.id === project.id)!;
  expect(updated.reportedBy).toBe("李明");
  const log = progressHistory(updated, after.activities)[0]!;
  expect(log).toMatchObject({
    author: "李明",
    originalSource: { workDate: "2026-10-17" },
  });
  expect(log.text).toContain("更新浏览器");
  expect(log.text).not.toContain("下周预计更换电脑");
  const rows = meetingResults(applied, after.projects);
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.assignee === "李明" && row.dailyReport)).toBe(
    true,
  );
  expect(
    rows.filter((row) => row.kind === "update").every((row) => !row.status),
  ).toBe(true);
  expect(rows.find((row) => row.kind === "task")).toMatchObject({
    taskId: task.id,
    assignee: "李明",
  });
});

it("reuses an identical reported follow-up and describes it as linked instead of newly created", async () => {
  const api = createLocalApi();
  const project = (await api.snapshot()).projects[0]!;
  const source = `李明\nReport to:王华\n今日工作总结\n1. ${project.name} 已沟通，下周培训`;
  const first = await api.propose(source);
  await api.applyProposal(first, review(first), {
    partial: true,
    updateMode: "append",
  });
  const before = await api.snapshot();
  const repeated = await api.propose(source);
  const applied = await api.applyProposal(repeated, review(repeated), {
    partial: true,
    updateMode: "append",
  });
  const after = await api.snapshot();
  expect(after.tasks).toEqual(before.tasks);
  expect(
    meetingResults(applied, after.projects).find((r) => r.kind === "task"),
  ).toMatchObject({ linked: true, assignee: "李明" });
});

it("keeps two authors on the same project as separate history entries without marking old tasks done", async () => {
  const api = createLocalApi();
  const before = await api.snapshot();
  const project = before.projects[0]!;
  const source = `李明\nReport to:王华\n今日工作总结\n1. ${project.name} 完成设备排查\n陈林\nReport to:王华\n今日工作总结\n1. ${project.name} 完成现场沟通`;
  const proposal = await api.propose(source);
  await api.applyProposal(proposal, review(proposal), {
    partial: true,
    updateMode: "append",
  });
  const after = await api.snapshot();
  expect(after.tasks).toEqual(before.tasks);
  const history = progressHistory(
    after.projects.find((p) => p.id === project.id)!,
    after.activities,
  );
  expect(
    history.filter((entry) => entry.text.includes("完成设备排查")),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ author: "李明" })]),
  );
  expect(
    history.filter((entry) => entry.text.includes("完成现场沟通")),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ author: "陈林" })]),
  );
});
