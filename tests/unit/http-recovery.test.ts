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
