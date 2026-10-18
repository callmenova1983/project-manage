import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../apps/web/src/services/mode", () => ({ browserDemo: false }));
import { HttpApi } from "../../apps/web/src/services/api";
import { createLocalApi } from "../../apps/web/src/services/local";
import { defaultModelSettings } from "../../packages/domain/admin";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
const futureExpiry = () => new Date(Date.now() + 86400000).toISOString();

it("sends only the allowance fields through the authenticated admin endpoint", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ actor: {}, csrf: "synthetic-csrf" }))
    .mockResolvedValueOnce(Response.json({ settings: defaultModelSettings }));
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpApi();
  await api.session();
  const input = { version: 7, maxRequests: 120, expiresAt: futureExpiry() };
  await api.saveModelAllowance(input);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, options] = fetcher.mock.calls[1]!;
  expect(url).toBe("/api/admin/model/allowance");
  expect(options).toMatchObject({
    method: "PUT",
    credentials: "same-origin",
    headers: { "x-csrf-token": "synthetic-csrf" },
  });
  expect(JSON.parse(String(options!.body))).toEqual(input);
  expect(new Headers(options!.headers).get("idempotency-key")).toBeTruthy();
});

it("persists a simulated allowance without credentials, external calls or enabling AI", async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  const api = createLocalApi();
  const before = await api.modelAdmin();
  const expiresAt = futureExpiry();
  const updated = await api.saveModelAllowance({
    version: before.settings.version,
    maxRequests: 120,
    expiresAt,
  });
  expect(updated).toMatchObject({
    allowanceEditable: true,
    usedAttempts: 0,
    maxRequests: 120,
    remainingAttempts: 120,
    expiresAt,
    credentialAvailable: false,
    runtimeEnabled: false,
    settings: { ...before.settings, version: before.settings.version + 1 },
  });
  expect(await createLocalApi().modelAdmin()).toEqual(updated);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await api.modelLogs()).map((entry) => entry.mode)).toEqual([
    "simulated",
  ]);
});

it("rejects stale or expired simulated updates without overwriting the saved allowance", async () => {
  const api = createLocalApi();
  const before = await api.modelAdmin();
  const saved = await api.saveModelAllowance({
    version: before.settings.version,
    maxRequests: 100,
    expiresAt: futureExpiry(),
  });
  await expect(
    api.saveModelAllowance({
      version: before.settings.version,
      maxRequests: 200,
      expiresAt: futureExpiry(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    api.saveModelAllowance({
      version: saved.settings.version,
      maxRequests: 200,
      expiresAt: new Date(Date.now() - 60000).toISOString(),
    }),
  ).rejects.toThrow();
  expect(await api.modelAdmin()).toEqual(saved);
});
