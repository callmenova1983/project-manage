import { describe, expect, it, vi } from "vitest";
import { createNotificationAdminApi } from "../../apps/web/src/services/notification-admin";
import { ApiError } from "../../apps/web/src/services/contracts";
import type {
  NotificationAdminState,
  NotificationConfigInput,
} from "../../packages/domain/notification-delivery";

const state: NotificationAdminState = {
  config: {
    version: 2,
    enabled: false,
    corpId: "synthetic-corp",
    agentId: 1000002,
    baseUrl: "https://projects.example.test",
    secretConfigured: true,
  },
  bindings: [],
  deliveries: [],
  directoryCorpId: "synthetic-corp",
  directoryVerified: true,
};
const config: NotificationConfigInput = {
  version: 1,
  enabled: false,
  corpId: "synthetic-corp",
  agentId: 1000002,
  baseUrl: "https://projects.example.test",
  secret: "synthetic-new-secret",
};
const session = () => Response.json({ csrf: "synthetic-csrf" });

describe("notification administration HTTP boundary", () => {
  it("never calls real administration from the demo adapter", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = createNotificationAdminApi("local", fetcher);
    for (const action of [
      () => service.state(),
      () => service.saveConfig(config),
      () => service.confirmBindings(["employee"], 1),
      () => service.retry("delivery", true),
    ])
      await expect(action()).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("obtains session CSRF before saving and uses only same-origin endpoints", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(Response.json(state));
    expect(
      await createNotificationAdminApi("server", fetcher).saveConfig(config),
    ).toEqual(state);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/session",
      "/api/admin/notifications/config",
    ]);
    const options = fetcher.mock.calls[1]![1]!;
    expect(options).toMatchObject({
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "x-csrf-token": "synthetic-csrf" },
    });
    expect(new Headers(options.headers).get("idempotency-key")).toMatch(
      /^[\da-f-]{36}$/,
    );
    expect(JSON.parse(String(options.body))).toEqual(config);
  });

  it("retains the mutation identity after an uncertain network result", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockRejectedValueOnce(new Error("private transport debug"))
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(Response.json(state));
    const service = createNotificationAdminApi("server", fetcher);
    await expect(service.retry("delivery")).rejects.not.toThrow(
      "private transport debug",
    );
    await service.retry("delivery");
    const first = new Headers(fetcher.mock.calls[1]![1]!.headers).get(
      "idempotency-key",
    );
    const second = new Headers(fetcher.mock.calls[3]![1]!.headers).get(
      "idempotency-key",
    );
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("requires an explicit unknown-delivery confirmation in the retry payload", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("/session") ? session() : Response.json(state),
      );
    const service = createNotificationAdminApi("server", fetcher);
    await service.retry("unknown-delivery");
    await service.retry("unknown-delivery", true);
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({
      id: "unknown-delivery",
    });
    expect(JSON.parse(String(fetcher.mock.calls[3]![1]!.body))).toEqual({
      id: "unknown-delivery",
      confirmUnknown: true,
    });
    const first = new Headers(fetcher.mock.calls[1]![1]!.headers).get(
      "idempotency-key",
    );
    const confirmed = new Headers(fetcher.mock.calls[3]![1]!.headers).get(
      "idempotency-key",
    );
    expect(confirmed).not.toBe(first);
  });

  it("does not expose proxy HTML and safely retries an unreadable committed response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response("<html>private proxy debug</html>"))
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(Response.json(state));
    const service = createNotificationAdminApi("server", fetcher);
    await expect(service.saveConfig(config)).rejects.not.toThrow(
      "private proxy debug",
    );
    await service.saveConfig(config);
    expect(fetcher.mock.calls[3]![1]!.headers).toEqual(
      fetcher.mock.calls[1]![1]!.headers,
    );
  });

  it("stops before changing settings when the authenticated session expired", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ message: "Authentication required" }, { status: 401 }),
      );
    await expect(
      createNotificationAdminApi("server", fetcher).confirmBindings(
        ["employee"],
        2,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
