import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";

it.each([
  { stage: "gettoken", errcode: 40001, explanation: "CorpID and Secret" },
  { stage: "department/list", errcode: 60020, explanation: "trusted IP list" },
  {
    stage: "department/list",
    errcode: 40001,
    explanation: "returned error 40001",
  },
])(
  "explains $errcode at $stage without leaking credentials or changing the directory",
  async ({ stage, errcode, explanation }) => {
    const origin = "http://localhost:4173";
    const fetcher = vi.fn();
    if (stage !== "gettoken")
      fetcher.mockResolvedValueOnce(
        Response.json({ access_token: "private-token" }),
      );
    fetcher.mockResolvedValueOnce(
      Response.json({ errcode, errmsg: "private remote diagnostics" }),
    );
    const { app, repo } = await buildApp({
      databasePath: ":memory:",
      origin,
      wecom: {
        corpId: "test-corp",
        secret: "private-secret",
        workspaceId: "a",
      },
      wecomFetch: fetcher,
    });
    try {
      repo.seed("a");
      await createUser(repo, {
        name: "Admin",
        email: "admin@example.test",
        password: "synthetic-password-for-test",
        workspaceId: "a",
      });
      repo.db.prepare("UPDATE users SET role='admin'").run();
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin },
        payload: {
          email: "admin@example.test",
          password: "synthetic-password-for-test",
        },
      });
      const before = repo.directory("a");
      const response = await app.inject({
        method: "POST",
        url: "/api/directory/wecom/sync",
        headers: {
          origin,
          cookie: `pm_session=${login.cookies[0]!.value}`,
          "x-csrf-token": login.json().csrf,
          "idempotency-key": randomUUID(),
        },
        payload: { version: before.version, confirmed: true },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({
        code: "WECOM_SYNC_FAILED",
        message: expect.stringContaining(explanation),
      });
      expect(response.body).not.toContain("private");
      expect(fetcher).toHaveBeenCalledTimes(stage === "gettoken" ? 1 : 2);
      expect(repo.directory("a")).toEqual(before);
    } finally {
      await app.close();
    }
  },
);
