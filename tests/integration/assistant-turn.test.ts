import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { QWEN_MODEL, type QwenConfig } from "../../apps/api/src/ai/config";
import {
  assistantProjectCsv,
  type AssistantTurn,
} from "../../packages/domain/assistant-plan";
import { intakeCandidates, parseDelimited } from "../../packages/domain/intake";
import {
  projectListRows,
  projectListSource,
} from "../fixtures/assistant-project-list";
let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173",
  fetcher = vi.fn<typeof fetch>();
const config: QwenConfig = {
  model: QWEN_MODEL,
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic",
  budgetId: "turn-test",
  maxRequests: 20,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 4096,
  retries: 0,
};
const send = (url: string, payload: unknown, key = randomUUID()) =>
  ctx.app.inject({
    method: "POST",
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
function model(plan: unknown) {
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        model: config.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(plan) },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}
describe.each(["legacy", "sdk"] as const)(
  "unified assistant semantics (%s)",
  (runtime) => {
    beforeEach(async () => {
      fetcher.mockReset();
      ctx = await buildApp({
        databasePath: ":memory:",
        origin,
        qwen: config,
        aiRuntime: runtime,
        aiFetch: fetcher,
      });
      ctx.repo.seed("turn");
      await createUser(ctx.repo, {
        workspaceId: "turn",
        name: "Tester",
        email: "turn@example.test",
        password: "Synthetic-Turn@2026",
      });
      const login = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "turn@example.test",
          password: "Synthetic-Turn@2026",
        },
        headers: { origin },
      });
      cookie = `pm_session=${login.cookies[0]!.value}`;
      csrf = login.json().csrf;
    });
    afterEach(() => ctx.app.close());
    it("retires every old semantic endpoint without rules, billing or business writes", async () => {
      const before = ctx.repo.snapshot("turn");
      for (const path of [
        "/api/proposals",
        "/api/proposals/qwen",
        "/api/assistant/query",
        "/api/projects/project-1/note-dates",
      ]) {
        const response = await send(path, {
          source: "新建测试项目",
          text: "今天有哪些任务",
        });
        expect(response.statusCode).toBe(410);
        expect(response.json().code).toBe("AI_ENDPOINT_RETIRED");
      }
      expect(fetcher).not.toHaveBeenCalled();
      expect(ctx.repo.snapshot("turn")).toEqual(before);
      expect(
        ctx.repo.db.prepare("SELECT count(*) AS n FROM ai_attempts").get()!.n,
      ).toBe(0);
      expect(
        ctx.repo.db.prepare("SELECT count(*) AS n FROM proposals").get()!.n,
      ).toBe(0);
    });
    const userSource = "客户名字 重庆市市院， 数字城市项目，地址是重庆";
    it("uses the full unsubmitted list after a short clarification reply, while unrelated history remains invalid evidence", async () => {
      const before = ctx.repo.snapshot("turn");
      const plan = {
        kind: "project",
        rows: projectListRows.map((row) => ({
          projectId: null,
          name: row.name,
          client: row.client,
          quote: `${row.number}\t${row.name}\t${row.client}`,
        })),
      };
      const followup = {
        source: "批量新建项目建档",
        externalProcessingConfirmed: true,
        recentMessages: [
          { role: "user", text: projectListSource, projectIds: [] },
          { role: "assistant", text: "这份清单要做什么操作？", projectIds: [] },
        ],
      };
      // Merely appearing in chat history must not authorize replaying an old request.
      model(plan);
      expect(
        (await send("/api/assistant/interpret", followup)).statusCode,
      ).toBe(502);
      expect(ctx.repo.snapshot("turn")).toEqual(before);
      model(plan);
      const result = await send("/api/assistant/interpret", {
        ...followup,
        draft: projectListSource,
      });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().plan.rows).toHaveLength(11);
      const table = assistantProjectCsv(
        result.json().plan.rows,
        before.projects,
      );
      const source = {
        kind: "csv" as const,
        name: "clarified project list",
        sheet: "",
        text: table,
        rows: parseDelimited(table),
        originalSource: { text: projectListSource, materialIds: [] },
      };
      const saved = await send("/api/intakes", {
        source,
        confirmed: true,
        rows: intakeCandidates(source, before.projects).map((candidate) => ({
          sourceRow: candidate.sourceRow,
          targetProjectId: candidate.targetProjectId,
          targetProjectVersion: candidate.targetProjectVersion,
          project: candidate.project,
          task: candidate.task,
          duplicateConfirmed: false,
        })),
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(
        saved.json().projects.map((p: { name: string; client: string }) => ({
          name: p.name,
          client: p.client,
        })),
      ).toEqual(projectListRows.map(({ name, client }) => ({ name, client })));
      expect(ctx.repo.snapshot("turn").tasks).toEqual(before.tasks);
    });
    it("keeps original report evidence and line locations when a later turn confirms how to record it", async () => {
      const before = ctx.repo.snapshot("turn");
      const draft = "日报原文\n项目接口联调完成，等待客户确认。";
      model({
        kind: "work",
        items: [
          {
            quote: "项目接口联调完成，等待客户确认。",
            title: "接口联调完成，等待确认",
            projectIds: [before.projects[0]!.id],
            action: "update",
            status: "in_progress",
          },
        ],
      });
      const result = await send("/api/assistant/interpret", {
        source: "记为该项目的进展日志",
        draft,
        externalProcessingConfirmed: true,
      });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json().proposal.source).toContain(draft);
      expect(result.json().proposal.suggestions[0].sourceLine).toBe(2);
      expect(ctx.repo.snapshot("turn")).toEqual(before);
    });
    it("sends unformatted text to Qwen, applies structured fields once, and reuses the existing project on a second turn", async () => {
      const before = ctx.repo.snapshot("turn");
      model({
        kind: "project",
        rows: [
          {
            projectId: null,
            name: "数字城市项目",
            client: "重庆市市院",
            address: "重庆",
            quote: userSource,
          },
        ],
      });
      const response = await send("/api/assistant/interpret", {
        source: userSource,
        externalProcessingConfirmed: true,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(
          JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).messages[1]
            .content,
        ),
      ).toContain(userSource);
      expect(ctx.repo.snapshot("turn")).toEqual(before); // Understanding alone never writes.
      const apply = async (turn: AssistantTurn) => {
        if (turn.plan.kind !== "project") throw Error("wrong plan");
        const snapshot = ctx.repo.snapshot("turn");
        const source = {
          kind: "text" as const,
          name: "AI",
          sheet: "",
          text: assistantProjectCsv(turn.plan.rows, snapshot.projects),
          rows: parseDelimited(
            assistantProjectCsv(turn.plan.rows, snapshot.projects),
          ),
          originalSource: { text: userSource, materialIds: [] },
        };
        return send("/api/intakes", {
          source,
          confirmed: true,
          rows: intakeCandidates(source, snapshot.projects).map((c) => ({
            sourceRow: c.sourceRow,
            sourcePart: c.sourcePart,
            project: c.project,
            task: c.task,
            targetProjectId: c.targetProjectId,
            targetProjectVersion: c.targetProjectVersion,
            duplicateConfirmed: false,
          })),
        });
      };
      expect((await apply(response.json())).statusCode).toBe(200);
      const saved = ctx.repo
        .snapshot("turn")
        .projects.find((p) => p.name === "数字城市项目")!;
      expect(saved).toMatchObject({
        client: "重庆市市院",
        owner: "Unassigned",
        description: "地址：重庆",
      });
      model({
        kind: "project",
        rows: [
          {
            projectId: saved.id,
            name: saved.name,
            client: saved.client,
            address: "重庆",
            quote: userSource,
          },
        ],
      });
      const repeat = await send("/api/assistant/interpret", {
        source: userSource,
        externalProcessingConfirmed: true,
      });
      expect(repeat.statusCode).toBe(200);
      expect(
        JSON.stringify(
          JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).messages[1]
            .content,
        ),
      ).toContain(saved.id);
      const result = await apply(repeat.json());
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ projects: [], tasks: [] });
      expect(ctx.repo.snapshot("turn").projects).toHaveLength(
        before.projects.length + 1,
      );
      expect(ctx.repo.snapshot("turn").tasks).toEqual(before.tasks);
    });
    it("uses model intent and typed query filters rather than words like today or project in the raw message", async () => {
      const before = ctx.repo.snapshot("turn");
      model({
        kind: "query",
        entity: "projects",
        projectIds: [],
        status: "all",
        range: "all",
      });
      const result = await send("/api/assistant/interpret", {
        source: "给我瞅瞅咱们手上都有啥活儿",
        externalProcessingConfirmed: true,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().answer.links).toHaveLength(before.projects.length);
      expect(ctx.repo.snapshot("turn")).toEqual(before);
    });
    it("preserves model work attribution and status without keyword repair or inferred fallback projects", async () => {
      const before = ctx.repo.snapshot("turn"),
        project = before.projects[0]!;
      const source = "沟通已完成，调试仍受网络阻塞。";
      model({
        kind: "work",
        items: [
          {
            sourceLine: 1,
            quote: source,
            title: source,
            projectIds: [project.id],
            action: "update",
            status: "blocked",
          },
        ],
      });
      const result = await send("/api/assistant/interpret", {
        source,
        externalProcessingConfirmed: true,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().proposal.suggestions[0]).toMatchObject({
        action: "update",
        status: "blocked",
        candidates: [{ projectId: project.id }],
      });
      const saved = ctx.repo.db
        .prepare("SELECT data FROM proposals WHERE id=?")
        .get(result.json().proposal.id)!;
      expect(JSON.parse(String(saved.data)).suggestions[0].status).toBe(
        "blocked",
      );
      expect(ctx.repo.snapshot("turn")).toEqual(before);
    });
    it("accepts screenshot report items using verbatim evidence without depending on list numbers or model line counting", async () => {
      const projects = ctx.repo.snapshot("turn").projects.slice(0, 4);
      const lines = [
        "五粮液 单点登录用户新增开发调试",
        "大榭 9月份xml数据拉取核对，氢能对接沟通跟进",
        "建工电梯设备数据调整",
        "丽水云和数据库备份",
      ];
      const source =
        "朱天翔\nReport to:郑元杰\n\n* 今日工作总结\n\n" +
        lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
      model({
        kind: "work",
        items: lines.map((quote, index) => ({
          ...(index % 2 === 0 ? { sourceLine: index + 1 } : {}),
          quote,
          title: quote,
          projectIds: [projects[index]!.id],
          action: "update",
          status: "in_progress",
          assignee: "朱天翔",
        })),
      });
      const before = ctx.repo.snapshot("turn");
      const result = await send("/api/assistant/interpret", {
        source,
        externalProcessingConfirmed: true,
      });
      expect(result.statusCode, result.body).toBe(200);
      expect(
        result
          .json()
          .proposal.suggestions.map(
            (item: { sourceLine: number }) => item.sourceLine,
          ),
      ).toEqual([6, 7, 8, 9]);
      expect(result.json().proposal.suggestions).toHaveLength(4);
      expect(
        result
          .json()
          .proposal.suggestions.every(
            (item: { action: string; status: string; assignee: string }) =>
              item.action === "update" &&
              item.status === "in_progress" &&
              item.assignee === "朱天翔",
          ),
      ).toBe(true);
      expect(ctx.repo.snapshot("turn")).toEqual(before);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const request = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      const content = request.messages.find(
        (message: { role: string }) => message.role === "user",
      ).content;
      const context = JSON.parse(
        typeof content === "string"
          ? content
          : content.map((part: { text: string }) => part.text).join("\n"),
      );
      expect(context.sourceLines[5]).toEqual({
        line: 6,
        text: `1. ${lines[0]}`,
      });
      if (runtime === "sdk")
        expect(request.response_format).toMatchObject({
          type: "json_schema",
          json_schema: { strict: true },
        });
    });
    it("keeps schema failure diagnostics without source content and rejects invented evidence", async () => {
      const before = ctx.repo.snapshot("turn");
      model({
        kind: "work",
        items: [
          {
            quote: "不存在的原文",
            title: "虚构事项",
            projectIds: [],
            action: "update",
            status: "todo",
          },
        ],
      });
      const result = await send("/api/assistant/interpret", {
        source: "真实原文，等客户确认。",
        externalProcessingConfirmed: true,
      });
      expect(result.statusCode).toBe(502);
      expect(result.json().code).toBe("AI_INVALID_OUTPUT");
      const log = JSON.parse(
        String(
          ctx.repo.db
            .prepare(
              "SELECT data FROM model_logs ORDER BY created_at DESC LIMIT 1",
            )
            .get()!.data,
        ),
      );
      expect(log.failureDiagnostic).toMatchObject({
        stage: "assistant-plan",
        reason: "work-evidence",
      });
      expect(JSON.stringify(log)).not.toContain("真实原文");
      expect(ctx.repo.snapshot("turn")).toEqual(before);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("leaves unknown project work pending rather than assigning the only project or skipping it", async () => {
      const source = "西南现场的网络接口还没打通";
      model({
        kind: "work",
        items: [
          {
            sourceLine: 1,
            quote: source,
            title: source,
            projectIds: [],
            action: "update",
            status: "blocked",
          },
        ],
      });
      const result = await send("/api/assistant/interpret", {
        source,
        externalProcessingConfirmed: true,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().proposal.suggestions[0].candidates).toEqual([]);
      expect(result.json().proposal.skippedSuggestionIds).toBeUndefined();
    });
    it("fails closed on invented owners, cross-workspace IDs and model transport errors", async () => {
      const before = ctx.repo.snapshot("turn");
      model({
        kind: "project",
        rows: [
          {
            projectId: null,
            name: "数字城市项目",
            owner: "郑元杰",
            quote: userSource,
          },
        ],
      });
      expect(
        (
          await send("/api/assistant/interpret", {
            source: userSource,
            externalProcessingConfirmed: true,
          })
        ).json().code,
      ).toBe("AI_INVALID_OUTPUT");
      model({
        kind: "query",
        entity: "projects",
        projectIds: ["foreign-id"],
        status: "all",
        range: "all",
      });
      expect(
        (
          await send("/api/assistant/interpret", {
            source: "看看另一个项目",
            externalProcessingConfirmed: true,
          })
        ).json().code,
      ).toBe("AI_INVALID_OUTPUT");
      fetcher.mockRejectedValueOnce(new Error("provider offline"));
      const failed = await send("/api/assistant/interpret", {
        source: userSource,
        externalProcessingConfirmed: true,
      });
      expect(failed.statusCode).toBeGreaterThanOrEqual(400);
      expect(failed.json()).not.toHaveProperty("plan");
      expect(ctx.repo.snapshot("turn")).toEqual(before);
    });
    it("replays the same interpretation key without another paid call or business writes", async () => {
      const key = randomUUID(),
        payload = { source: userSource, externalProcessingConfirmed: true };
      model({ kind: "clarify", question: "您要处理哪个项目？" });
      const first = await send("/api/assistant/interpret", payload, key),
        again = await send("/api/assistant/interpret", payload, key);
      expect(first.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each(["disabled", "expired"] as const)(
      "does not fall back to rules when AI is %s",
      async (reason) => {
        await ctx.app.close();
        ctx = await buildApp({
          databasePath: ":memory:",
          origin,
          aiRuntime: runtime,
          aiFetch: fetcher,
          ...(reason === "expired"
            ? { qwen: { ...config, expiresAt: Date.now() - 1000 } }
            : {}),
        });
        ctx.repo.seed("turn");
        await createUser(ctx.repo, {
          workspaceId: "turn",
          name: "Tester",
          email: "unavailable@example.test",
          password: "Synthetic-Turn@2026",
        });
        const login = await ctx.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "unavailable@example.test",
            password: "Synthetic-Turn@2026",
          },
          headers: { origin },
        });
        cookie = `pm_session=${login.cookies[0]!.value}`;
        csrf = login.json().csrf;
        const before = ctx.repo.snapshot("turn");
        const result = await send("/api/assistant/interpret", {
          source: userSource,
          externalProcessingConfirmed: true,
        });
        expect(result.statusCode).toBe(reason === "expired" ? 429 : 503);
        expect(result.json().code).toBe(
          reason === "expired" ? "AI_BUDGET_EXPIRED" : "AI_DISABLED",
        );
        expect(result.json()).not.toHaveProperty("plan");
        expect(fetcher).not.toHaveBeenCalled();
        expect(ctx.repo.snapshot("turn")).toEqual(before);
      },
    );
    it("cleans only the caller's temporary recognition sources after successful interpretation and can replay the result", async () => {
      const uploaded = await send("/api/capture/materials", {
        name: "会议记录.txt",
        data: Buffer.from("临时记录").toString("base64"),
        referenceOnly: true,
      });
      expect(uploaded.statusCode).toBe(200);
      const id = uploaded.json().id,
        key = randomUUID();
      const payload = {
        source: userSource,
        externalProcessingConfirmed: true,
        originalSource: { text: userSource, materialIds: [] },
        temporaryMaterialIds: [id],
      };
      model({
        kind: "project",
        rows: [
          {
            projectId: null,
            name: "数字城市项目",
            client: "重庆市市院",
            address: "重庆",
            quote: userSource,
          },
        ],
      });
      const first = await send("/api/assistant/interpret", payload, key);
      expect(first.statusCode, first.body).toBe(200);
      expect(
        ctx.repo.db
          .prepare("SELECT id FROM progress_materials WHERE id=?")
          .get(id),
      ).toBeUndefined();
      expect(
        (await send("/api/assistant/interpret", payload, key)).json(),
      ).toEqual(first.json());
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  },
);
