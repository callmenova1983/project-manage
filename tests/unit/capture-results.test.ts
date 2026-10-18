import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { suggest, type Proposal } from "../../packages/domain/types";
import { settleMeetingProposal } from "../../packages/domain/meeting-completion";
import { createLocalApi } from "../../apps/web/src/services/local";
import {
  dailyLogResults,
  intakeResults,
  meetingResults,
  resultLocation,
} from "../../apps/web/src/services/capture-results";
const { projects, tasks } = createSeed();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
const proposal: Proposal = {
  id: "capture",
  source: "Atlas: 跟进设备\nMeridian: 安装完成\n稍后处理\n尚未保存",
  sourceVersion: 1,
  status: "draft",
  createdAt: new Date().toISOString(),
  suggestions: suggest(
    "Atlas: 跟进设备\nMeridian: 安装完成\n稍后处理\n尚未保存",
    projects,
  ),
};
it("lists only persisted or explicitly skipped items and links exact IDs, never matching duplicate titles", () => {
  const first = {
    ...proposal.suggestions[0]!,
    action: "task" as const,
    selectedProjectId: projects[0]!.id,
    status: "blocked" as const,
  };
  const second = {
    ...proposal.suggestions[1]!,
    action: "update" as const,
    selectedProjectId: projects[1]!.id,
  };
  const result = settleMeetingProposal(
    proposal,
    [first, second],
    {
      partial: true,
      skippedIds: [proposal.suggestions[2]!.id],
    },
    {
      appliedResults: [
        {
          suggestionId: first.id,
          projectId: first.selectedProjectId,
          taskId: "exact-task",
        },
        { suggestionId: second.id, projectId: second.selectedProjectId },
      ],
      createdProjectIds: [projects[1]!.id],
    },
  );
  const rows = meetingResults(result, projects);
  expect(rows.map((r) => r.kind)).toEqual([
    "project",
    "task",
    "update",
    "skipped",
  ]);
  expect(rows[1]).toMatchObject({
    title: first.title,
    status: "blocked",
    taskId: "exact-task",
  });
  expect(resultLocation(rows[1]!)).toBe(
    `/projects/${projects[0]!.id}#task-exact-task`,
  );
  expect(resultLocation(rows[2]!)).toBe(
    `/projects/${projects[1]!.id}#progress-history`,
  );
  const snapshot = structuredClone(rows);
  const completed = settleMeetingProposal(result, [proposal.suggestions[3]!], {
    partial: true,
  });
  expect(completed.appliedResults).toEqual(result.appliedResults);
  expect(completed.createdProjectIds).toEqual(result.createdProjectIds);
  expect(rows).toEqual(snapshot); // Previous messages retain their own result snapshot.
});
it("supports older saved proposals without invented task IDs and unavailable projects without broken links", () => {
  const saved = {
    ...proposal,
    status: "applied" as const,
    suggestions: [
      {
        ...proposal.suggestions[0]!,
        action: "task" as const,
        selectedProjectId: projects[0]!.id,
      },
    ],
  };
  const row = meetingResults(saved, projects)[0]!;
  expect(row.taskId).toBeUndefined();
  expect(resultLocation(row)).toBe(`/projects/${projects[0]!.id}`);
  expect(resultLocation(meetingResults(saved, [])[0]!)).toBeUndefined();
});
it("shows new projects and tasks from table input, and separates recorded logs from pending rows", () => {
  const task = { ...tasks[0]!, projectId: projects[0]!.id };
  const rows = intakeResults(
    {
      id: "batch",
      createdAt: "now",
      actor: "actor",
      state: "applied",
      source: { kind: "text", name: "source", sheet: "", text: "source" },
      projects: [projects[0]!],
      tasks: [task],
      entries: [],
    },
    projects,
  );
  expect(rows.map((r) => r.kind)).toEqual(["project", "task"]);
  expect(resultLocation(rows[1]!)).toBe(
    `/projects/${task.projectId}#task-${task.id}`,
  );
  const daily = dailyLogResults(
    {
      id: "log",
      source: "日志",
      reporter: "同事",
      workDate: "2026-10-16",
      createdAt: "now",
      rows: [
        {
          sourceLine: 1,
          text: "完成安装",
          later: false,
          projectId: projects[0]!.id,
          status: "recorded",
        },
        { sourceLine: 2, text: "归属待确认", later: true, status: "pending" },
      ],
    },
    projects,
  );
  expect(daily.map((r) => r.kind)).toEqual(["update", "pending"]);
  expect(resultLocation(daily[1]!)).toBeUndefined();
});
it("local mode returns the actual task and project created during a partial apply", async () => {
  const api = createLocalApi();
  const source = await api.propose("新增设备核对工作");
  const suggestion = source.suggestions[0]!;
  const result = await api.applyProposal(
    source,
    [
      {
        id: suggestion.id,
        selectedProjectId: "__new_project__",
        title: suggestion.title,
        action: "task",
        status: "todo",
        confirmed: true,
        overwriteConfirmed: false,
      },
    ],
    {
      partial: true,
      updateMode: "append",
      newProject: {
        suggestionId: suggestion.id,
        name: `回执测试${crypto.randomUUID()}`,
        channelId: "company",
        confirmed: true,
      },
    },
  );
  const state = await api.snapshot();
  const receipt = result.appliedResults![0]!;
  expect(result.createdProjectIds).toEqual([receipt.projectId]);
  expect(state.tasks.find((task) => task.id === receipt.taskId)).toMatchObject({
    projectId: receipt.projectId,
    title: suggestion.title,
  });
});
