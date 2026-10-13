import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";

it("explains a rejected enterprise IP without exposing remote details or changing the directory", async () => {
  const origin = "http://localhost:4173";
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "private-token" }))
    .mockResolvedValueOnce(
      Response.json({ errcode: 60020, errmsg: "private remote diagnostics" }),
    );
  const { app, repo } = await buildApp({
    databasePath: ":memory:",
    origin,
    wecom: { corpId: "test-corp", secret: "private-secret", workspaceId: "a" },
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
      message: expect.stringContaining("trusted IP list"),
    });
    expect(response.body).not.toContain("private");
    expect(repo.directory("a")).toEqual(before);
  } finally {
    await app.close();
  }
});
