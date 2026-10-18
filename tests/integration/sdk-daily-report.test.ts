import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { QWEN_MODEL } from "../../apps/api/src/ai/config";
import type { Proposal } from "../../packages/domain/types";

it("persists SDK semantic splits as attributed progress and future work exactly once", async () => {
  const origin = "http://localhost:4173",
    workspaceId = "sdk-report";
  const fetcher = vi.fn<typeof fetch>();
  const { app, repo } = await buildApp({
    databasePath: ":memory:",
    origin,
    aiRuntime: "sdk",
    aiFetch: fetcher,
    qwen: {
      region: "cn-beijing",
      model: QWEN_MODEL,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "synthetic-key",
      budgetId: "sdk-report",
      maxRequests: 3,
      expiresAt: Date.now() + 60000,
      timeoutMs: 3000,
      maxTokens: 2048,
      retries: 0,
    },
  });
  try {
    repo.seed(workspaceId);
    await createUser(repo, {
      email: "sdk@example.test",
      name: "录入员",
      password: "synthetic-password",
      workspaceId,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "sdk@example.test", password: "synthetic-password" },
    });
    const headers = {
      origin,
      cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
    };
    const post = (url: string, payload: object, key = randomUUID()) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...headers, "idempotency-key": key },
        payload,
      });
    const project = repo.snapshot(workspaceId).projects[0]!;
    const first = `${project.name}已核对设备清单`,
      second = "约好周五到场联调";
    fetcher.mockResolvedValue(
      Response.json({
        model: QWEN_MODEL,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                suggestions: [
                  {
                    sourceLine: 3,
                    quote: first,
                    title: first,
                    projectIds: [project.id],
                    reason: "原文项目",
                    action: "update",
                    status: "done",
                    reportMeaning: "performed",
                  },
                  {
                    sourceLine: 3,
                    quote: second,
                    title: second,
                    projectIds: [project.id],
                    reason: "同条项目",
                    action: "task",
                    status: "todo",
                    reportMeaning: "planned",
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    );
    const before = repo.snapshot(workspaceId);
    const proposed = await post("/api/proposals/qwen", {
      source: `林甲\n今日工作总结\n1. ${first}，${second}`,
      externalProcessingConfirmed: true,
    });
    expect(proposed.statusCode, proposed.body).toBe(200);
    const proposal = proposed.json<Proposal>();
    expect(proposal.suggestions).toHaveLength(2);
    const body = {
      updateMode: "append",
      suggestions: proposal.suggestions.map((s) => ({
        id: s.id,
        selectedProjectId: project.id,
        title: s.title,
        action: s.action,
        status: s.status,
        confirmed: true,
        overwriteConfirmed: false,
      })),
    };
    const key = randomUUID();
    const applied = await post(
      `/api/proposals/${proposal.id}/apply`,
      body,
      key,
    );
    expect(applied.statusCode, applied.body).toBe(200);
    expect(
      (await post(`/api/proposals/${proposal.id}/apply`, body, key)).body,
    ).toBe(applied.body);
    const after = repo.snapshot(workspaceId);
    const added = after.tasks.filter(
      (task) => !before.tasks.some((old) => old.id === task.id),
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      title: second,
      status: "todo",
      assignee: "林甲",
    });
    expect(
      after.projects.find((item) => item.id === project.id)!.latestUpdate,
    ).toContain(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
