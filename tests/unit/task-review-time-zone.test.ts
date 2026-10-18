import { describe, expect, it } from "vitest";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config.js";
import { makeTaskReviewRequest } from "../../apps/api/src/ai/task-review.js";
import { taskSchema } from "../../packages/domain/types.js";

const config: QwenConfig = {
  model: QWEN_MODEL,
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic-test-token",
  budgetId: "task-review-time-zone",
  maxRequests: 3,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 2048,
  retries: 0,
};
const task = taskSchema.parse({
  id: "task",
  version: 1,
  updatedAt: "2026-10-15T18:20:00Z",
  projectId: "project",
  parentId: null,
  title: "明天联系客户，提醒我",
  description: "",
  status: "todo",
  assignee: "",
  dueDate: null,
  workDates: [],
  workWeek: null,
});
const now = new Date("2026-10-15T18:20:00Z");

describe("task review workspace calendar context", () => {
  it.each([
    ["UTC", "2026-10-15"],
    ["Asia/Shanghai", "2026-10-16"],
    ["Asia/Kathmandu", "2026-10-16"],
    ["America/St_Johns", "2026-10-15"],
  ])(
    "uses %s in both the calendar date and instructions",
    (timeZone, today) => {
      const request = makeTaskReviewRequest(task, config, timeZone, now);
      const instructions = request.messages[0]!.content;
      expect(JSON.parse(request.messages[1]!.content)).toEqual({
        today,
        timeZone,
        task,
      });
      expect(instructions).toContain(`工作区 ${timeZone} 时区`);
      if (timeZone !== "Asia/Shanghai")
        expect(instructions).not.toContain("Asia/Shanghai");
      expect(instructions).toContain("带正确时区偏移的 ISO 时间");
      expect(instructions).toContain("用户确认后才可采用");
      expect(instructions).toContain("区分预计时间");
      expect(instructions).toContain("明确最晚完成时间");
      expect(instructions).not.toContain(task.title);
    },
  );

  it("honors the quarter-hour midnight boundary instead of rounding offsets", () => {
    const before = makeTaskReviewRequest(
      task,
      config,
      "Asia/Kathmandu",
      new Date("2026-10-15T18:14:59.999Z"),
    );
    const after = makeTaskReviewRequest(
      task,
      config,
      "Asia/Kathmandu",
      new Date("2026-10-15T18:15:00Z"),
    );
    expect(JSON.parse(before.messages[1]!.content).today).toBe("2026-10-15");
    expect(JSON.parse(after.messages[1]!.content).today).toBe("2026-10-16");
  });

  it("defaults legacy calls to UTC and rejects invalid zones without fallback", () => {
    const request = makeTaskReviewRequest(task, config, undefined, now);
    expect(JSON.parse(request.messages[1]!.content)).toMatchObject({
      today: "2026-10-15",
      timeZone: "UTC",
    });
    expect(() =>
      makeTaskReviewRequest(task, config, "invalid-zone", now),
    ).toThrow();
    expect(() => makeTaskReviewRequest(task, config, "+08:00", now)).toThrow();
  });
});
