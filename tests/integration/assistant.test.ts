import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import type { QwenConfig } from "../../apps/api/src/ai/config";
import { DEFAULT_SPEECH_MODEL } from "../../packages/domain/speech";
let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173",
  fetcher = vi.fn<typeof fetch>();
const config: QwenConfig = {
  model: "qwen3.8-max",
  region: "cn-beijing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "synthetic-test-key",
  budgetId: "assistant-test",
  maxRequests: 20,
  expiresAt: Date.parse("2099-01-01"),
  timeoutMs: 1000,
  maxTokens: 2048,
  retries: 0,
};
const send = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: {
      cookie,
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
  });
function wav(seconds = 1) {
  const buffer = Buffer.alloc(44 + seconds * 32000);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer.toString("base64");
}
async function login(email: string) {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "Synthetic-Assistant@2026" },
  });
  cookie = `pm_session=${response.cookies[0]!.value}`;
  csrf = response.json().csrf;
}
beforeEach(async () => {
  fetcher.mockReset();
  ctx = await buildApp({
    databasePath: ":memory:",
    origin,
    qwen: config,
    aiFetch: fetcher,
  });
  ctx.repo.seed("assistant");
  await createUser(ctx.repo, {
    workspaceId: "assistant",
    name: "Assistant Tester",
    email: "assistant@example.test",
    password: "Synthetic-Assistant@2026",
  });
  await login("assistant@example.test");
});
afterEach(() => ctx.app.close());
it("persists private conversation, unfinished draft and attachment references with optimistic concurrency", async () => {
  expect((await send("GET", "/api/assistant/session")).json()).toEqual({
    version: 0,
    updatedAt: null,
    state: {},
  });
  const state = {
    composer: "北二码头的照片归档",
    messages: [{ role: "user", text: "今天有什么待办" }],
    attachments: { materials: [{ id: randomUUID(), name: "现场照片.png" }] },
  };
  expect(
    (await send("PUT", "/api/assistant/session", { version: 0, state })).json(),
  ).toMatchObject({ version: 1, state });
  expect((await send("GET", "/api/assistant/session")).json()).toMatchObject({
    version: 1,
    state,
  });
  expect(
    (
      await send("PUT", "/api/assistant/session", {
        version: 0,
        state: { composer: "stale" },
      })
    ).statusCode,
  ).toBe(409);
  await createUser(ctx.repo, {
    workspaceId: "assistant",
    name: "Other",
    email: "other@example.test",
    password: "Synthetic-Assistant@2026",
  });
  await login("other@example.test");
  expect((await send("GET", "/api/assistant/session")).json().state).toEqual(
    {},
  );
});
it("rehydrates the authoritative proposal so a lost apply response cannot re-create tasks", async () => {
  const project = ctx.repo.snapshot("assistant").projects[0]!;
  const proposal = (
    await send("POST", "/api/proposals", {
      source: `${project.name}：确认现场点位`,
    })
  ).json();
  await send("PUT", "/api/assistant/session", {
    version: 0,
    state: { proposal, composer: "" },
  });
  const updated = {
    ...proposal,
    status: "applied",
    appliedSuggestionIds: proposal.suggestions.map((s: { id: string }) => s.id),
  };
  ctx.repo.db
    .prepare("UPDATE proposals SET data=? WHERE id=?")
    .run(JSON.stringify(updated), proposal.id);
  expect(
    (await send("GET", "/api/assistant/session")).json().state.proposal.status,
  ).toBe("applied");
});
it("answers real task and project queries without external calls or mutations", async () => {
  const before = ctx.repo.snapshot("assistant"),
    project = before.projects[0]!;
  const answer = await send("POST", "/api/assistant/query", {
    text: `${project.name}进展怎么样？`,
  });
  expect(answer.statusCode).toBe(200);
  expect(answer.json()).toMatchObject({ handled: true });
  expect(answer.json().text).toContain(project.latestUpdate || "尚未记录进展");
  const tasks = (
    await send("POST", "/api/assistant/query", {
      text: "有哪些未完成任务？",
      projectId: project.id,
    })
  ).json();
  expect(
    tasks.links.every((link: { path: string }) =>
      link.path.includes(project.id),
    ),
  ).toBe(true);
  expect(
    (
      await send("POST", "/api/assistant/query", { text: "新建项目：现场平台" })
    ).json().handled,
  ).toBe(false);
  expect(
    (
      await send("POST", "/api/assistant/query", {
        text: "进展怎么样？",
        projectId: "foreign-project",
      })
    ).statusCode,
  ).toBe(404);
  expect(ctx.repo.snapshot("assistant")).toEqual(before);
  expect(fetcher).not.toHaveBeenCalled();
});
it("filters persisted tasks by day, week, owner, overdue, blocked and done without writes", async () => {
  const snapshot = ctx.repo.snapshot("assistant");
  const template = snapshot.tasks[0]!;
  const member = snapshot.members?.find((m) => m.name === "Assistant Tester");
  expect(member).toBeDefined();
  if (!member) throw new Error("Missing authenticated member fixture");
  ctx.repo.db
    .prepare("DELETE FROM tasks WHERE workspace_id=?")
    .run("assistant");
  const cases = [
    {
      id: "today-open",
      status: "todo",
      workDates: ["2026-10-19"],
      workWeek: "2026-10-19",
      dueDate: null,
    },
    {
      id: "week-open",
      status: "in_progress",
      workDates: ["2026-10-21"],
      workWeek: "2026-10-19",
      dueDate: null,
    },
    {
      id: "late",
      status: "todo",
      workDates: [],
      workWeek: null,
      dueDate: "2026-10-18",
    },
    {
      id: "blocked",
      status: "blocked",
      workDates: [],
      workWeek: null,
      dueDate: null,
    },
    {
      id: "finished",
      status: "done",
      workDates: ["2026-10-19"],
      workWeek: "2026-10-19",
      dueDate: "2026-10-18",
    },
  ] as const;
  for (const task of cases)
    ctx.repo.putTask("assistant", {
      ...template,
      ...task,
      title: task.id,
      workDates: [...task.workDates],
      assignee: task.id === "week-open" ? "Other Person" : member.name,
      assigneeId: task.id === "week-open" ? null : member.id,
    });
  const before = ctx.repo.snapshot("assistant");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  try {
    await login("assistant@example.test");
    for (const [text, expected] of [
      ["今天有哪些任务？", ["today-open"]],
      ["本周有哪些任务？", ["today-open", "week-open"]],
      ["有哪些我的任务？", ["today-open", "late", "blocked", "finished"]],
      ["有哪些逾期任务？", ["late"]],
      ["有哪些受阻任务？", ["blocked"]],
      ["有哪些已完成任务？", ["finished"]],
    ] as const) {
      const response = await send("POST", "/api/assistant/query", {
        text,
        projectId: template.projectId,
      });
      expect(response.statusCode, text).toBe(200);
      const answer = response.json();
      expect(answer.handled, text).toBe(true);
      expect(
        answer.links.map((link: { title: string }) => link.title).sort(),
        text,
      ).toEqual([...expected].sort());
    }
    expect(ctx.repo.snapshot("assistant")).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("defaults to Qwen ASR, sends audio only, persists actual usage and replays once", async () => {
  const capability = (await send("GET", "/api/assistant/speech")).json();
  expect(capability).toMatchObject({
    enabled: true,
    model: DEFAULT_SPEECH_MODEL,
    maxSeconds: 120,
  });
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "北二码头增加一项现场检查任务。" } }],
        usage: { prompt_tokens: 25, completion_tokens: 12, seconds: 1 },
      }),
    ),
  );
  const input = { requestId: randomUUID(), mime: "audio/wav", data: wav() };
  const before = ctx.repo.snapshot("assistant");
  const response = await send("POST", "/api/assistant/transcribe", input);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    text: "北二码头增加一项现场检查任务。",
    model: DEFAULT_SPEECH_MODEL,
    seconds: 1,
  });
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe(config.baseUrl + "/chat/completions");
  const wire = JSON.parse(String(options!.body));
  expect(wire).toMatchObject({
    model: DEFAULT_SPEECH_MODEL,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: `data:audio/wav;base64,${input.data}` },
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(wire)).not.toContain(before.projects[0]!.name);
  expect(
    (await send("POST", "/api/assistant/transcribe", input)).json(),
  ).toEqual(response.json());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const logs = ctx.repo.db.prepare("SELECT data FROM model_logs").all();
  expect(logs).toHaveLength(1);
  expect(JSON.parse(String(logs[0]!.data))).toMatchObject({
    model: DEFAULT_SPEECH_MODEL,
    purpose: "speech-transcription",
    inputTokens: 25,
    outputTokens: 12,
    audioSeconds: 1,
    status: "succeeded",
  });
  expect(String(logs[0]!.data)).not.toContain(input.data);
  const usage = (await send("GET", "/api/ai/usage")).json();
  expect(usage).toMatchObject({
    totalTokens: 37,
    speech: { requests: 1, recordedSeconds: 1, unmeasuredRequests: 0 },
  });
  expect(ctx.repo.snapshot("assistant")).toEqual(before);
});
it("does not duplicate an in-flight transcription or hide unknown usage as zero", async () => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const input = { requestId: randomUUID(), mime: "audio/wav", data: wav() };
  const first = send("POST", "/api/assistant/transcribe", input);
  const pending = first.then((value) => value);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    (await send("POST", "/api/assistant/transcribe", input)).json().code,
  ).toBe("ASR_RUNNING");
  finish(
    new Response(
      JSON.stringify({ choices: [{ message: { content: "现场检查完成" } }] }),
    ),
  );
  expect((await pending).statusCode).toBe(200);
  const usage = (await send("GET", "/api/ai/usage")).json();
  expect(usage).toMatchObject({
    unmeasuredRequests: 1,
    speech: { unmeasuredRequests: 1 },
  });
});
it("validates audio before billing, respects the existing allowance, and never rotates it", async () => {
  const invalid = await send("POST", "/api/assistant/transcribe", {
    requestId: randomUUID(),
    mime: "audio/wav",
    data: Buffer.from("not an actual WAV".repeat(20)).toString("base64"),
  });
  expect(invalid.statusCode).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const user = ctx.repo.db
    .prepare("SELECT id FROM users WHERE email=?")
    .get("assistant@example.test")!;
  for (let i = 0; i < config.maxRequests; i++)
    ctx.repo.db
      .prepare(
        "INSERT INTO ai_attempts(id,budget_id,user_id,created_at) VALUES(?,?,?,?)",
      )
      .run(randomUUID(), config.budgetId, user.id, Date.now());
  expect((await send("GET", "/api/assistant/speech")).json().enabled).toBe(
    false,
  );
  const result = await send("POST", "/api/assistant/transcribe", {
    requestId: randomUUID(),
    mime: "audio/wav",
    data: wav(),
  });
  expect(result.statusCode).toBe(503);
  expect(result.json().message).toContain("额度");
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    ctx.repo.db.prepare("SELECT count(*) AS n FROM ai_attempts").get()!.n,
  ).toBe(config.maxRequests);
});
it("never retries a billed provider failure automatically or leaks its response", async () => {
  fetcher.mockResolvedValue(
    new Response("synthetic secret provider detail", { status: 403 }),
  );
  const input = { requestId: randomUUID(), mime: "audio/wav", data: wav() };
  const result = await send("POST", "/api/assistant/transcribe", input);
  expect(result.statusCode).toBe(502);
  expect(result.body).not.toContain("synthetic secret");
  expect(
    (await send("POST", "/api/assistant/transcribe", input)).statusCode,
  ).toBe(409);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("honors the requested English locale without translating project or task data", async () => {
  const before = ctx.repo.snapshot("assistant");
  const response = await send("POST", "/api/assistant/query", {
    text: "Show tasks this week",
    locale: "en",
  });
  expect(response.statusCode).toBe(200);
  const answer = response.json();
  expect(answer.handled).toBe(true);
  expect(answer.text).toContain("tasks found");
  expect(answer.text).not.toMatch(/[\p{Script=Han}]/u);
  expect(ctx.repo.snapshot("assistant")).toEqual(before);
  expect(fetcher).not.toHaveBeenCalled();
});
