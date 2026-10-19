import { describe, expect, it } from "vitest";
import { parseDailyReport } from "../../packages/domain/daily-report.js";

describe("daily report semantics", () => {
  it.each(["约好周五到场联调", "约定星期三培训"])(
    "keeps appointments as future work: %s",
    (text) => {
      expect(
        parseDailyReport(`陈晨\n今日工作总结\n1. 青禾学校${text}`)?.[0],
      ).toMatchObject({ action: "task", status: "todo" });
    },
  );
  it.each([
    ["下周安排李强检查水表", "李强"],
    ["由李强完成点位复核", "李强"],
    ["安排设备检查时间", "陈晨"],
  ])(
    "resolves explicit actor in %s without assigning objects",
    (text, assignee) => {
      const entries = parseDailyReport(
        `陈晨\nReport to:赵经理\n今日工作总结\n1. 青禾学校${text}`,
      )!;
      expect(entries[0]?.assignee).toBe(assignee);
    },
  );

  it.each([
    ["2026年10月12日", "2026-10-12", undefined],
    ["2026年2月3日", "2026-02-03", undefined],
    ["2026年2月30日", undefined, true],
  ])(
    "preserves Chinese report date %s and source",
    (date, workDate, invalidWorkDate) => {
      const source = `陈晨\nReport to:赵经理\n${date}\n今日工作总结\n1. 青禾学校回路核对已完成`;
      const entries = parseDailyReport(source)!;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        workDate,
        invalidWorkDate,
        assignee: "陈晨",
      });
      expect(entries[0]?.sourceText).toBe(source.split("\n")[4]);
    },
  );

  it("records numbered daily work without creating three new todos", () => {
    const source = `李明
Report to:王华

* 今日工作总结
1. 示例学校二期离线设备排查
2. 示例学校二期新加的开关面板加入以及BMS打点
3. 示例学校TTL空调调整和老校区人体传感器调整`;
    const entries = parseDailyReport(source)!;
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.action)).toEqual([
      "update",
      "update",
      "update",
    ]);
    expect(entries.map((entry) => entry.sourceLine)).toEqual([5, 6, 7]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        status: "done",
        reporter: "李明",
        reportTo: "王华",
        assignee: "李明",
      });
      expect(entry.sourceText).toBe(source.split("\n")[entry.sourceLine - 1]);
      expect(entry.workDate).toBeUndefined();
      expect(entry).not.toHaveProperty("taskId");
    }
  });

  it("separates four reported facts from two tentative future actions", () => {
    const source = `张珊
Report to:王华

* 今日工作总结
1、沟通示例建工运维小程序流程梳理，问题沟通整理
2、处理示例住建断网问题，一楼值班室平台（更新浏览器，下周预计会更换新电脑）
3、沟通自动化修改开启等设置操作，线上培训预约下周时间
4、沟通确认示例住建建工新增设备清单。`;
    const entries = parseDailyReport(source)!;
    expect(entries.filter((entry) => entry.action === "update")).toHaveLength(
      4,
    );
    const tasks = entries.filter((entry) => entry.action === "task");
    expect(tasks.map((entry) => entry.title)).toEqual([
      "下周预计会更换新电脑",
      "线上培训预约下周时间",
    ]);
    expect(tasks[0]!.contextText).toContain("示例住建断网问题");
    for (const entry of entries) {
      expect(entry.assignee).toBe("张珊");
      expect(entry.reportTo).toBe("王华");
      expect(entry.sourceText).toBe(source.split("\n")[entry.sourceLine - 1]);
      expect(entry).not.toHaveProperty("dueDate");
    }
  });

  it("retains unfinished reasons and only creates an explicitly stated next step", () => {
    const entries = parseDailyReport(`汇报人：李明
今日工作总结
1. 示例项目设备仍在排查，尚未完成
2. 示例项目上线受阻，等待客户审批
3. 示例项目配置未完成，明天继续排查
4. 示例项目明天不需要继续排查`)!;
    expect(entries.map(({ action, status }) => ({ action, status }))).toEqual([
      { action: "update", status: "in_progress" },
      { action: "update", status: "blocked" },
      { action: "update", status: "in_progress" },
      { action: "task", status: "todo" },
      { action: "update", status: "in_progress" },
    ]);
    expect(entries[1]!.title).toContain("等待客户审批");
  });

  it("keeps each reporter separate and honors a body-level assignee", () => {
    const entries = parseDailyReport(`2026-10-17
李明
Report to:王华
今日工作总结
1. 示例项目完成排查

张珊
Report to:赵青
今日工作总结
1. 示例项目已完成联调
2. 示例项目由陈林负责下周培训`)!;
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.reporter)).toEqual([
      "李明",
      "张珊",
      "张珊",
    ]);
    expect(entries.map((entry) => entry.assignee)).toEqual([
      "李明",
      "张珊",
      "陈林",
    ]);
    expect(entries.map((entry) => entry.reportTo)).toEqual([
      "王华",
      "赵青",
      "赵青",
    ]);
    expect(entries.every((entry) => entry.workDate === "2026-10-17")).toBe(
      true,
    );
  });

  it("does not leak a recipient or personal date to another reporter", () => {
    const entries = parseDailyReport(`李明
Report to:王华
2026-10-16 工作日报
1. 示例项目调试
张珊
今日工作总结
1. 示例项目培训`)!;
    expect(entries[0]!).toMatchObject({
      reporter: "李明",
      workDate: "2026-10-16",
      reportTo: "王华",
    });
    expect(entries[1]!.reporter).toBe("张珊");
    expect(entries[1]!.workDate).toBeUndefined();
    expect(entries[1]!.reportTo).toBeUndefined();
  });

  it("uses explicit future sections while retaining the project context", () => {
    const entries = parseDailyReport(`李明的工作日报
日期：2026-10-17
示例学校：
今日工作总结
1. 完成浏览器更新。检查网络连接。
后续工作计划
1. 线上培训，时间待定
今日工作总结
1. 处理设备掉线`)!;
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.action)).toEqual([
      "update",
      "update",
      "task",
      "update",
    ]);
    expect(entries[2]!.title).toBe("后续：线上培训，时间待定");
    expect(entries[2]!.contextText).toContain("示例学校");
    expect(entries.every((entry) => entry.reporter === "李明")).toBe(true);
  });

  it("keeps standalone continuation lines attached to their numbered project", () => {
    const entries = parseDailyReport(`工作日报
1. 示例学校完成网络排查
下周预计更换电脑`)!;
    expect(entries).toHaveLength(2);
    expect(entries[1]!).toMatchObject({
      action: "task",
      sourceLine: 3,
      sourceText: "下周预计更换电脑",
    });
    expect(entries[1]!.contextText).toContain("示例学校");
    expect(entries[1]!.assignee).toBeUndefined();
  });

  it("keeps an app-provided project heading as context rather than a work item", () => {
    const entries = parseDailyReport(`项目：示例学校
李明
Report to:王华
今日工作总结
1. 设备排查
张珊
今日工作总结
1. 下周预计更换电脑`)!;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.action)).toEqual(["update", "task"]);
    for (const entry of entries) {
      expect(entry.contextText).toContain("项目：示例学校");
      expect(entry.contextText!.startsWith(entry.sourceText)).toBe(true);
    }
  });

  it("inherits an explicit assignee across clauses but prefers a clause-level person", () => {
    const entries = parseDailyReport(`汇报人：李明
今日工作总结
1. 示例项目由陈林负责，今天完成排查，明天继续调试
2. 示例项目由陈林负责，今天完成联调，下周由张珊负责培训`)!;
    expect(entries.map((entry) => entry.assignee)).toEqual([
      "陈林",
      "陈林",
      "陈林",
      "张珊",
    ]);
    expect(entries.every((entry) => entry.reporter === "李明")).toBe(true);
  });

  it("keeps a future section's time in both title and provenance", () => {
    const entries = parseDailyReport(`工作日报
今日工作总结
1. 完成排查
下周工作计划
1. 预约线上培训，时间待定`)!;
    expect(entries[1]!).toMatchObject({
      action: "task",
      title: "下周：预约线上培训，时间待定",
    });
    expect(entries[1]!.contextText).toContain("下周工作计划");
    expect(entries[1]!.sourceText).toBe("1. 预约线上培训，时间待定");
    expect(entries[1]!.workDate).toBeUndefined();
  });

  it("never lets a future assignee overwrite who performed today's work", () => {
    const entries = parseDailyReport(`汇报人：李明
今日工作总结
1. 示例学校设备排查，下周由张珊负责示例平台培训
2. 示例学校由陈林负责今天联调，明天继续处理，下周由张珊负责培训`)!;
    expect(entries.map((entry) => entry.assignee)).toEqual([
      "李明",
      "张珊",
      "陈林",
      "陈林",
      "张珊",
    ]);
    expect(entries[0]!).toMatchObject({ action: "update", reporter: "李明" });
    expect(entries[1]!).toMatchObject({ action: "task", reporter: "李明" });
  });

  it("does not treat arbitrary or oversized reporter metadata as a name or a work item", () => {
    const entries = parseDailyReport(`汇报人：${"甲".repeat(81)}
今日工作总结
1. 示例项目排查
汇报人：李明 Report to:王华
今日工作总结
1. 示例项目联调`)!;
    expect(entries).toHaveLength(2);
    expect(
      entries.every(
        (entry) => entry.reporter === undefined && entry.assignee === undefined,
      ),
    ).toBe(true);
  });

  it("attaches an ownership-only suffix to the preceding action", () => {
    const entries = parseDailyReport(`汇报人：李明
今日工作总结
1. 示例项目下周安排培训，由陈林负责
2. 示例项目今天处理设备，明天由张珊负责培训
3. 负责人：陈林，示例项目下周复核设备`)!;
    expect(
      entries.map(({ action, assignee }) => ({ action, assignee })),
    ).toEqual([
      { action: "task", assignee: "陈林" },
      { action: "update", assignee: "李明" },
      { action: "task", assignee: "张珊" },
      { action: "task", assignee: "陈林" },
    ]);
    expect(entries[0]!.title).toBe("示例项目下周安排培训，由陈林负责");
  });

  it("marks invalid explicit dates without borrowing today or another reporter's date", () => {
    const entries = parseDailyReport(`李明
Report to:王华
2026-02-30 工作日报
1. 示例项目下周培训
张珊
今日工作总结
1. 示例项目下周更换电脑`)!;
    expect(entries[0]!.workDate).toBeUndefined();
    expect(entries[0]!.invalidWorkDate).toBe(true);
    expect(entries[1]!.invalidWorkDate).toBeUndefined();
    expect(entries[1]!.workDate).toBeUndefined();
    const shared = parseDailyReport(`日期：2026-02-30
李明
今日工作总结
1. 示例项目下周培训
张珊
今日工作总结
日期：2026-10-17
1. 示例项目下周更换电脑`)!;
    expect(shared[0]!.invalidWorkDate).toBe(true);
    expect(shared[1]!.invalidWorkDate).toBeUndefined();
    expect(shared[1]!.workDate).toBe("2026-10-17");
  });

  it("requires report framing and never infers a date from today or next week", () => {
    expect(
      parseDailyReport("示例项目：明天排查设备\n示例项目：下周培训"),
    ).toBeNull();
    expect(parseDailyReport("请帮我编写今日工作总结")).toBeNull();
    const entries = parseDailyReport(
      "工作日报\n日期：2026-02-30\n1. 下周预计更换电脑",
    )!;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.workDate).toBeUndefined();
    expect(entries[0]!.invalidWorkDate).toBe(true);
    expect(entries[0]!.title).toBe("下周预计更换电脑");
  });
});
