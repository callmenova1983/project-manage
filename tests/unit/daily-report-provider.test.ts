import { describe, expect, it } from "vitest";
import {
  makeRequest,
  validateSuggestions,
} from "../../apps/api/src/ai/provider.js";
import { readQwenConfig } from "../../apps/api/src/ai/config.js";
import { createSeed } from "../../packages/domain/seed.js";

const template = createSeed().projects[0]!;
const projects = [
  {
    ...template,
    id: "school",
    name: "青禾示例学校",
    shortName: "青禾学校",
    aliases: [],
  },
  {
    ...template,
    id: "housing",
    name: "示例运维平台",
    shortName: "示例运维",
    aliases: [],
  },
];
const report = [
  "李明",
  "Report to:王经理",
  "日期：2026-10-16",
  "* 今日工作总结",
  "1. 青禾学校二期离线设备排查",
  "2. 青禾学校二期新加开关面板加入以及BMS打点",
  "3. 青禾学校空调调整和人体传感器调整",
].join("\n");

function item(sourceLine: number, quote: string, overrides = {}) {
  return {
    sourceLine,
    quote,
    title: quote,
    projectIds: ["school"],
    reason: "原文项目名称对应",
    action: "task",
    status: "todo",
    ...overrides,
  };
}

describe("source-backed daily reports in the Qwen provider", () => {
  it.each([
    ["示例运维平台明天继续排查", "unfinished", "task", "todo"],
    ["示例运维平台取消下周培训", "performed", "update", "in_progress"],
    ["示例运维平台取消下周培训", "planned", "update", "in_progress"],
    ["示例运维平台尚未修复", "performed", "update", "in_progress"],
    ["示例运维平台等待客户批准", "performed", "update", "blocked"],
  ])(
    "keeps explicit source constraints when the model misclassifies %s as %s",
    (text, reportMeaning, action, status) => {
      const [result] = validateSuggestions(
        { suggestions: [item(3, text, { reportMeaning })] },
        `李明\n今日工作总结\n1. ${text}`,
        projects,
      );
      expect(result).toMatchObject({ action, status, assignee: "李明" });
    },
  );
  it("accepts a source-complete model split beyond the keyword parser", () => {
    const current = "青禾学校已核对设备清单";
    const future = "约好月底到场联调";
    const source = `李明\nReport to:王经理\n今日工作总结\n1. ${current}，${future}`;
    const results = validateSuggestions(
      {
        suggestions: [
          item(4, current, { reportMeaning: "performed" }),
          item(4, future, { reportMeaning: "planned" }),
        ],
      },
      source,
      projects,
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: current,
      action: "update",
      status: "done",
      assignee: "李明",
    });
    expect(results[1]).toMatchObject({
      title: future,
      action: "task",
      status: "todo",
      assignee: "李明",
    });
    expect(
      results.every((result) => result.sourceText === source.split("\n")[3]),
    ).toBe(true);
  });
  it.each([
    ["青禾学校已核对设备清单", "月底到场联调"],
    ["青禾学校已核对设备清单，约好", "约好月底到场联调"],
  ])(
    "rejects missing or overlapping source in model splits",
    (first, second) => {
      const source =
        "李明\n今日工作总结\n1. 青禾学校已核对设备清单，约好月底到场联调";
      expect(() =>
        validateSuggestions(
          {
            suggestions: [
              item(3, first, { reportMeaning: "performed" }),
              item(3, second, { reportMeaning: "planned" }),
            ],
          },
          source,
          projects,
        ),
      ).toThrow();
    },
  );
  it.each([
    ["青禾学校配件没到现场，施工只能搁置", "blocked", "update", "blocked"],
    ["青禾学校联调只差最后一次复核", "unfinished", "update", "in_progress"],
    ["青禾学校约好周五到场联调", "planned", "task", "todo"],
  ])(
    "uses full-quote semantic classification for %s",
    (text, reportMeaning, action, status) => {
      const source = `李明\nReport to:王经理\n今日工作总结\n1. ${text}`;
      const [result] = validateSuggestions(
        { suggestions: [item(4, text, { reportMeaning, assignee: "王经理" })] },
        source,
        projects,
      );
      expect(result).toMatchObject({
        title: text,
        action,
        status,
        assignee: "李明",
        reporter: "李明",
        dailyReport: true,
      });
      expect(result).not.toHaveProperty("dueDate");
    },
  );
  it("does not let a partial quote override the meaning of an entire activity", () => {
    const source = "李明\n今日工作总结\n1. 青禾学校培训已完成";
    const [result] = validateSuggestions(
      { suggestions: [item(3, "青禾学校", { reportMeaning: "planned" })] },
      source,
      projects,
    );
    expect(result).toMatchObject({ action: "update", status: "done" });
  });
  it("rejects conflicting full-quote classifications instead of choosing one", () => {
    const text = "青禾学校联调只差复核";
    expect(() =>
      validateSuggestions(
        {
          suggestions: [
            item(3, text, { title: "联调", reportMeaning: "performed" }),
            item(3, text, { title: "复核", reportMeaning: "unfinished" }),
          ],
        },
        `李明\n今日工作总结\n1. ${text}`,
        projects,
      ),
    ).toThrow();
  });
  it("does not borrow another clause's project through a generated title", () => {
    const source =
      "李明\n今日工作总结\n1. 青禾学校设备排查，下周示例运维平台培训";
    const suggestions = validateSuggestions(
      {
        suggestions: [
          item(3, "青禾学校设备排查", {
            title: "下周示例运维平台培训",
          }),
        ],
      },
      source,
      projects,
    );
    expect(suggestions).toHaveLength(2);
    expect(
      suggestions[0]!.candidates.map((candidate) => candidate.projectId),
    ).toEqual(["school"]);
    expect(
      suggestions[1]!.candidates.map((candidate) => candidate.projectId),
    ).toEqual(["housing"]);
  });

  it("keeps an invalid reported date from becoming today's date after model extraction", () => {
    const source = "李明\n日期：2026-02-30\n今日工作总结\n1. 青禾学校下周培训";
    const [suggestion] = validateSuggestions(
      { suggestions: [] },
      source,
      projects,
    );
    expect(suggestion).toMatchObject({
      dailyReport: true,
      invalidWorkDate: true,
      assignee: "李明",
    });
    expect(suggestion!.workDate).toBeUndefined();
  });

  it("rejects an oversized report instead of silently dropping its remaining work", () => {
    const source =
      "李明\n今日工作总结\n" +
      Array.from(
        { length: 51 },
        (_, i) => `${i + 1}. 青禾学校完成第${i + 1}项检查`,
      ).join("\n");
    expect(() =>
      validateSuggestions({ suggestions: [] }, source, projects),
    ).toThrow();
  });

  it("corrects model-created todos into daily facts and defaults attribution to the reporter", () => {
    const suggestions = validateSuggestions(
      {
        suggestions: report
          .split("\n")
          .slice(4)
          .map((line, i) => item(i + 5, line, { assignee: "王经理" })),
      },
      report,
      projects,
    );
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions)
      expect(suggestion).toMatchObject({
        action: "update",
        status: "done",
        dailyReport: true,
        reporter: "李明",
        reportTo: "王经理",
        assignee: "李明",
        workDate: "2026-10-16",
        confirmed: false,
        overwriteConfirmed: false,
      });
    expect(suggestions[0]!.sourceText).toBe(report.split("\n")[4]);
  });

  it("splits today's work from next week's tentative task even if the model merged them", () => {
    const line =
      "1、处理示例运维断网问题，一楼值班室平台（更新浏览器，下周预计会更换新电脑）";
    const source = `李明\nReport to:王经理\n今日工作总结\n${line}`;
    const suggestions = validateSuggestions(
      { suggestions: [item(4, line, { projectIds: ["housing"] })] },
      source,
      projects,
    );
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      action: "update",
      assignee: "李明",
    });
    expect(suggestions[1]).toMatchObject({
      action: "task",
      status: "todo",
      title: "下周预计会更换新电脑",
      reporter: "李明",
      assignee: "李明",
      sourceText: line,
    });
    expect(
      suggestions[1]!.candidates.map((candidate) => candidate.projectId),
    ).toEqual(["housing"]);
    expect(suggestions[1]).not.toHaveProperty("dueDate");
  });

  it("keeps same-line project matching separate for distinct report clauses", () => {
    const line = "1. 青禾学校设备排查，下周由张华负责示例运维平台培训";
    const source = `李明\nReport to:王经理\n今日工作总结\n${line}`;
    const suggestions = validateSuggestions(
      {
        suggestions: [
          item(4, "青禾学校设备排查"),
          item(4, "下周由张华负责示例运维平台培训", {
            projectIds: ["housing"],
            assignee: "虚构人员",
          }),
        ],
      },
      source,
      projects,
    );
    expect(suggestions[0]).toMatchObject({
      action: "update",
      assignee: "李明",
    });
    expect(
      suggestions[0]!.candidates.map((candidate) => candidate.projectId),
    ).toEqual(["school"]);
    expect(suggestions[1]).toMatchObject({
      action: "task",
      reporter: "李明",
      assignee: "张华",
    });
    expect(
      suggestions[1]!.candidates.map((candidate) => candidate.projectId),
    ).toEqual(["housing"]);
  });

  it("removes metadata-only model suggestions and falls back to explicit short names", () => {
    const suggestions = validateSuggestions(
      { suggestions: [item(1, "李明"), item(2, "Report to:王经理")] },
      report,
      projects,
    );
    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((suggestion) => suggestion.sourceLine >= 5)).toBe(
      true,
    );
    expect(
      suggestions.every(
        (suggestion) => suggestion.candidates[0]?.projectId === "school",
      ),
    ).toBe(true);
  });

  it("preserves ambiguous model candidates instead of choosing a project arbitrarily", () => {
    const suggestions = validateSuggestions(
      {
        suggestions: [
          item(5, report.split("\n")[4]!, {
            projectIds: ["school", "housing"],
          }),
        ],
      },
      report,
      projects,
    );
    expect(
      suggestions[0]!.candidates.map((candidate) => candidate.projectId),
    ).toEqual(["school", "housing"]);
    expect(suggestions[0]!.selectedProjectId).toBe("");
  });

  it("does not fabricate a reporter when the report has no author", () => {
    const source = "今日工作总结\n1. 青禾学校设备排查";
    const [suggestion] = validateSuggestions(
      { suggestions: [item(2, "青禾学校设备排查", { assignee: "虚构人员" })] },
      source,
      projects,
    );
    expect(suggestion).toMatchObject({ action: "update", dailyReport: true });
    expect(suggestion!.reporter).toBeUndefined();
    expect(suggestion!.assignee).toBeUndefined();
  });

  it("keeps each author's identity in a batch of daily reports", () => {
    const source = [
      "李明",
      "Report to:王经理",
      "今日工作总结",
      "1. 青禾学校设备排查",
      "张华",
      "Report to:王经理",
      "今日工作总结",
      "1. 示例运维平台问题尚未解决，等待客户确认",
      "明日计划",
      "1. 示例运维平台培训",
    ].join("\n");
    const suggestions = validateSuggestions(
      { suggestions: [] },
      source,
      projects,
    );
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toMatchObject({
      reporter: "李明",
      assignee: "李明",
      action: "update",
      status: "done",
    });
    expect(suggestions[1]).toMatchObject({
      reporter: "张华",
      assignee: "张华",
      action: "update",
      status: "blocked",
    });
    expect(suggestions[2]).toMatchObject({
      reporter: "张华",
      assignee: "张华",
      action: "task",
      status: "todo",
    });
  });

  it("preserves the existing contract for ordinary notes", () => {
    const source = "青禾学校设备排查";
    const [suggestion] = validateSuggestions(
      { suggestions: [item(1, source)] },
      source,
      projects,
    );
    expect(suggestion).toMatchObject({
      title: source,
      action: "task",
      status: "todo",
    });
    expect(suggestion).not.toHaveProperty("dailyReport");
    expect(suggestion).not.toHaveProperty("assignee");
  });

  it("supplies report context and short names to the model without changing project keys", () => {
    const config = readQwenConfig({
      AI_PROVIDER: "qwen",
      AI_CALLS_ENABLED: "true",
      QWEN_REGION: "cn-beijing",
      QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      DASHSCOPE_API_KEY: "synthetic-test-token",
      AI_BUDGET_ID: "daily-report-tests",
      AI_MAX_REQUESTS: "1",
      AI_BUDGET_EXPIRES_AT: "2099-01-01T00:00:00Z",
    })!;
    const request = makeRequest(report, projects, config);
    const input = JSON.parse(request.messages[1]!.content);
    expect(input.dailyReportEntries).toHaveLength(3);
    expect(input.dailyReportEntries[0]).toMatchObject({
      reporter: "李明",
      assignee: "李明",
      action: "update",
    });
    expect(Object.keys(input.projects[0]).sort()).toEqual([
      "aliases",
      "id",
      "name",
    ]);
    expect(input.projects[0].aliases).toContain("青禾学校");
    expect(request.messages[0]!.content).toContain(
      "Report to / 汇报对象 identifies only the recipient",
    );
    expect(request.messages[0]!.content).toContain(
      "never claim an entire project or existing task was completed",
    );
    expect(request.messages[0]!.content).not.toContain("李明");
  });
});
