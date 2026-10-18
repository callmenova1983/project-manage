import { describe, expect, it } from "vitest";
import { answerAssistantQuery } from "../../packages/domain/assistant";
import { createSeed } from "../../packages/domain/seed";

const snapshot = createSeed();
const project = snapshot.projects[0]!;
const template = snapshot.tasks.find((task) => task.projectId === project.id)!;
snapshot.tasks = [
  {
    ...template,
    id: "open",
    title: "现场排查",
    status: "todo",
    assignee: "测试人",
    assigneeId: "tester",
  },
  {
    ...template,
    id: "done",
    title: "点位确认",
    status: "done",
    assignee: "测试人",
    assigneeId: "tester",
  },
  {
    ...template,
    id: "other",
    title: "他人任务",
    status: "todo",
    assignee: "其他人",
    assigneeId: "other",
  },
];
const actor = { id: "tester", name: "测试人" };
const query = (text: string) =>
  answerAssistantQuery({ text, projectId: project.id }, snapshot, actor);

describe("assistant read-only intent and completion filters", () => {
  it.each([
    "有哪些已完成任务？",
    "列出完成的任务",
    "完成了哪些任务？",
    "show completed tasks",
  ])("answers completed work without routing to intake: %s", (text) => {
    const answer = query(text);
    expect(answer.handled).toBe(true);
    expect(answer.links.map((link) => link.title)).toEqual(["点位确认"]);
  });
  it.each([
    "有哪些未完成的任务？",
    "列出未完成任务",
    "show unfinished tasks",
    "show tasks not completed",
  ])("keeps incomplete work distinct: %s", (text) => {
    expect(query(text).links.map((link) => link.title)).toEqual([
      "现场排查",
      "他人任务",
    ]);
  });
  it.each(["列出分给我的任务", "show tasks assigned to me"])(
    "recognizes assignment as a read filter: %s",
    (text) => {
      expect(query(text).links.map((link) => link.title)).toEqual([
        "现场排查",
        "点位确认",
      ]);
    },
  );
  it.each([
    "把任务标记为已完成",
    "请把任务分给我？",
    "现场排查已完成",
    "新建任务：确认点位",
    "修改任务截止日期",
    "assign tasks to me",
  ])("does not turn write intent into a read: %s", (text) => {
    expect(query(text).handled).toBe(false);
  });
  it("leaves the authoritative snapshot untouched", () => {
    const before = structuredClone(snapshot);
    query("有哪些已完成任务？");
    query("列出未完成的任务");
    expect(snapshot).toEqual(before);
  });
});
