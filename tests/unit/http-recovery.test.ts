import { afterEach, it, expect, vi } from "vitest";
vi.mock("../../apps/web/src/services/mode", () => ({ browserDemo: false }));
import { HttpApi, ApiError } from "../../apps/web/src/services/api";
afterEach(() => vi.unstubAllGlobals());
it("normalizes HTML/empty proxy responses without exposing their contents", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("<html>private proxy detail</html>", { status: 503 }),
    )
    .mockResolvedValueOnce(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const api = new HttpApi();
  await expect(api.session()).rejects.toMatchObject({
    status: 503,
    message: expect.stringContaining("unreadable response"),
  });
  await expect(api.session()).rejects.toMatchObject({ status: 401 });
});
it("retains the same mutation key after an unreadable successful response", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("", { status: 200 }))
    .mockResolvedValueOnce(Response.json({ actor: {}, csrf: "synthetic" }));
  vi.stubGlobal("fetch", fetch);
  const api = new HttpApi();
  await expect(
    api.login("test@example.test", "synthetic"),
  ).rejects.toBeInstanceOf(ApiError);
  await api.login("test@example.test", "synthetic");
  expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).toBe(
    fetch.mock.calls[1]![1].headers["idempotency-key"],
  );
});

const actor = { id: "user-a", workspaceId: "workspace-a" };
const session = (csrf = "fresh", identity = actor) =>
  Response.json({ actor: identity, csrf });
const invalidToken = () =>
  Response.json({ message: "Invalid request token" }, { status: 403 });

it("retains bulk mutation identity across a lost response and client reload", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const saved = [{ id: "synthetic-task", version: 2 }];
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session())
    .mockRejectedValueOnce(new TypeError("Synthetic connection loss"))
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json(saved));
  vi.stubGlobal("fetch", fetcher);
  const payload = {
    targets: [{ id: "synthetic-task", version: 1 }],
    change: { field: "dueDate" as const, value: null },
  };
  const original = new HttpApi();
  await original.session();
  await expect(original.bulkUpdateTasks(payload)).rejects.toBeInstanceOf(
    ApiError,
  );
  const reloaded = new HttpApi();
  await reloaded.session();
  await expect(reloaded.bulkUpdateTasks(payload)).resolves.toEqual(saved);
  const mutations = fetcher.mock.calls.filter(
    ([url]) => url === "/api/tasks/bulk-update",
  );
  expect(mutations).toHaveLength(2);
  expect(mutations[0]![1].headers["idempotency-key"]).toBe(
    mutations[1]![1].headers["idempotency-key"],
  );
  expect(mutations[0]![1].body).toBe(mutations[1]![1].body);
});
it("preserves structured bulk conflicts without replaying failed writes", async () => {
  const conflicts = [
    {
      id: "synthetic-task",
      reason: "Task version changed.",
      currentVersion: 3,
    },
  ];
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(
      Response.json(
        { message: "Synthetic conflict", conflicts },
        { status: 409 },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  await expect(
    api.bulkUpdateTasks({
      targets: [{ id: "synthetic-task", version: 1 }],
      change: { field: "status", value: "done" },
    }),
  ).rejects.toMatchObject({ status: 409, conflicts });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("initializes a missing token before a history query after a client reload", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(Response.json({ events: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(new HttpApi().activityPage({ limit: 25 })).resolves.toEqual({
    events: [],
  });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/auth/session",
    "/api/activity/query",
  ]);
  expect(fetcher.mock.calls[1]![1].headers["x-csrf-token"]).toBe("fresh");
});

it("refreshes a stale token once and preserves the history filter", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session("stale"))
    .mockResolvedValueOnce(invalidToken())
    .mockResolvedValueOnce(session("fresh"))
    .mockResolvedValueOnce(Response.json({ events: [{ id: "event-a" }] }));
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  const query = { projectIds: ["project-a"], limit: 25 };
  await expect(api.activityPage(query)).resolves.toEqual({
    events: [{ id: "event-a" }],
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls[1]![1].headers["x-csrf-token"]).toBe("stale");
  expect(fetcher.mock.calls[3]![1].headers["x-csrf-token"]).toBe("fresh");
  expect(fetcher.mock.calls[3]![1].body).toBe(JSON.stringify(query));
});

it("shares session initialization across concurrent history query and export", async () => {
  let sessionCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/session") {
        sessionCalls++;
        return session();
      }
      return Response.json({ events: [] });
    }),
  );
  const api = new HttpApi();
  await Promise.all([api.activityPage({}), api.exportActivity({})]);
  expect(sessionCalls).toBe(1);
});

it("does not retry history indefinitely when the refreshed token is rejected", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session("stale"))
    .mockResolvedValueOnce(invalidToken())
    .mockResolvedValueOnce(session("fresh"))
    .mockResolvedValueOnce(invalidToken());
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  await expect(api.exportActivity({})).rejects.toMatchObject({ status: 403 });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("keeps permission errors and expired sessions visible without replaying history", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(
      Response.json({ message: "Access denied" }, { status: 403 }),
    )
    .mockResolvedValueOnce(invalidToken())
    .mockResolvedValueOnce(
      Response.json(
        { message: "Your session expired. Sign in again." },
        { status: 401 },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  await expect(api.activityPage({})).rejects.toMatchObject({
    status: 403,
    message: "Access denied",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(api.activityPage({})).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("stops recovery if the browser session has switched accounts", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session("stale"))
    .mockResolvedValueOnce(invalidToken())
    .mockResolvedValueOnce(
      session("fresh", { id: "user-b", workspaceId: "workspace-b" }),
    );
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  await expect(api.activityPage({})).rejects.toMatchObject({
    status: 401,
    message: "Your session changed. Refresh the page before trying again.",
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

const wecomInput = {
  version: 0,
  corpId: "synthetic-corp",
  secret: "synthetic-secret",
};
const savedWecom = {
  version: 1,
  corpId: "synthetic-corp",
  secretConfigured: true,
  source: "workspace",
};
it("recovers an empty or stale request token for WeCom config without changing the payload or mutation key", async () => {
  for (const initialized of [false, true]) {
    const fetcher = vi.fn();
    if (initialized) fetcher.mockResolvedValueOnce(session("stale"));
    fetcher
      .mockResolvedValueOnce(invalidToken())
      .mockResolvedValueOnce(session("fresh"))
      .mockResolvedValueOnce(Response.json(savedWecom));
    vi.stubGlobal("fetch", fetcher);
    const api = new HttpApi();
    if (initialized) await api.session();
    await expect(api.saveWecomConfiguration(wecomInput)).resolves.toEqual(
      savedWecom,
    );
    const mutations = fetcher.mock.calls.filter(
      ([url]) => url === "/api/directory/wecom/config",
    );
    expect(mutations).toHaveLength(2);
    expect(mutations[0]![1].headers["x-csrf-token"]).toBe(
      initialized ? "stale" : "",
    );
    expect(mutations[1]![1].headers["x-csrf-token"]).toBe("fresh");
    expect(mutations[1]![1].headers["idempotency-key"]).toBe(
      mutations[0]![1].headers["idempotency-key"],
    );
    expect(mutations[1]![1].body).toBe(mutations[0]![1].body);
    expect(mutations[1]![1].body).toBe(JSON.stringify(wecomInput));
  }
});
it("never auto-replays configuration writes after permission, conflict, network, or unreadable errors", async () => {
  for (const response of [
    Response.json({ message: "Access denied" }, { status: 403 }),
    Response.json({ message: "Synthetic conflict" }, { status: 409 }),
    Response.json({ message: "Synthetic failure" }, { status: 500 }),
    new Response("private proxy detail", { status: 502 }),
  ]) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetcher);
    const api = new HttpApi();
    await api.session();
    await expect(api.saveWecomConfiguration(wecomInput)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});
it("limits config token recovery to one replay and stops on an account/workspace switch", async () => {
  for (const switched of [false, true]) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(session("stale"))
      .mockResolvedValueOnce(invalidToken())
      .mockResolvedValueOnce(
        session(
          "fresh",
          switched ? { id: "user-b", workspaceId: "workspace-b" } : actor,
        ),
      );
    if (!switched) fetcher.mockResolvedValueOnce(invalidToken());
    vi.stubGlobal("fetch", fetcher);
    const api = new HttpApi();
    await api.session();
    await expect(api.saveWecomConfiguration(wecomInput)).rejects.toMatchObject({
      status: switched ? 401 : 403,
    });
    expect(fetcher).toHaveBeenCalledTimes(switched ? 3 : 4);
  }
});

it("keeps configuration drafts after a network failure without automatic replay", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session())
    .mockRejectedValueOnce(new TypeError("Synthetic offline"));
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  await expect(api.saveWecomConfiguration(wecomInput)).rejects.toMatchObject({
    message: expect.stringContaining("Your changes are still here"),
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("shares one credential refresh across concurrent rejected configuration writes", async () => {
  let sessionCalls = 0,
    rejected = 0;
  let release!: () => void;
  const bothSent = new Promise<void>((resolve) => (release = resolve));
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/auth/session")
      return session(++sessionCalls === 1 ? "stale" : "fresh");
    if (
      (options?.headers as Record<string, string>)["x-csrf-token"] === "stale"
    ) {
      if (++rejected === 2) release();
      await bothSent;
      return invalidToken();
    }
    return Response.json(savedWecom);
  });
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  await Promise.all([
    api.saveWecomConfiguration(wecomInput),
    api.saveWecomConfiguration({ ...wecomInput, corpId: "synthetic-second" }),
  ]);
  expect(sessionCalls).toBe(2);
  expect(
    fetcher.mock.calls.filter(([url]) => url === "/api/directory/wecom/config"),
  ).toHaveLength(4);
});
it("does not replay a pending config after login changes while credential refresh is in flight", async () => {
  let release!: (response: Response) => void;
  const fetching = new Promise<Response>((resolve) => (release = resolve));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(session("stale"))
    .mockResolvedValueOnce(invalidToken())
    .mockReturnValueOnce(fetching)
    .mockResolvedValueOnce(
      session("new-login", { id: "user-b", workspaceId: "workspace-b" }),
    );
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  const saving = api.saveWecomConfiguration(wecomInput);
  const result = expect(saving).rejects.toMatchObject({ status: 401 });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await api.login("second@example.test", "synthetic-password");
  release(session());
  await result;
  expect(fetcher).toHaveBeenCalledTimes(4);
});
