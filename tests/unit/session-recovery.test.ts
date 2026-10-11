import { beforeEach, it, expect, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { createSeed } from "../../packages/domain/seed";
import type { Snapshot } from "../../packages/domain/types";
const api = vi.hoisted(() => ({
  mode: "server",
  session: vi.fn(),
  snapshot: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../../apps/web/src/services/api", async () => ({
  api,
  ApiError: (await import("../../apps/web/src/services/contracts")).ApiError,
}));
import { ApiError } from "../../apps/web/src/services/contracts";
import { useWorkspace } from "../../apps/web/src/stores/workspace";
const actor = {
  id: "a",
  workspaceId: "one",
  name: "A",
  email: "a@example.test",
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  api.snapshot.mockResolvedValue(createSeed());
  api.session.mockResolvedValue({ actor });
});
it("distinguishes unavailable service from signed-out and can retry", async () => {
  const store = useWorkspace();
  api.session.mockRejectedValueOnce(new ApiError("Unavailable", 503));
  await store.initialize();
  expect(store.sessionState).toBe("unavailable");
  expect(store.user).toBeNull();
  await store.initialize();
  expect(store.sessionState).toBe("authenticated");
  expect(store.data.projects.length).toBe(20);
  api.session.mockRejectedValueOnce(new ApiError("Sign in", 401));
  await store.initialize();
  expect(store.sessionState).toBe("signed_out");
  expect(store.error).toBe("");
  expect(store.data.projects).toEqual([]);
});
it("keeps last synced data on transport failure but clears all account data on 401", async () => {
  const store = useWorkspace();
  await store.initialize();
  const time = store.lastSynced;
  api.snapshot.mockRejectedValueOnce(new ApiError("Network", 503));
  await store.refresh();
  expect(store.data.projects.length).toBe(20);
  expect(store.lastSynced).toEqual(time);
  expect(store.error).toBe("Network");
  api.snapshot.mockRejectedValueOnce(new ApiError("Expired", 401));
  await store.refresh();
  expect(store.user).toBeNull();
  expect(store.data.tasks).toEqual([]);
  expect(store.lastSynced).toBeNull();
});
it("never shows a previous account snapshot after a different account logs in", async () => {
  const store = useWorkspace();
  await store.initialize();
  api.login.mockResolvedValue({
    actor: { ...actor, id: "b", workspaceId: "two" },
  });
  api.snapshot.mockRejectedValueOnce(new ApiError("Network", 503));
  await store.login("b@example.test", "synthetic");
  expect(store.user?.id).toBe("b");
  expect(store.data.projects).toEqual([]);
  expect(store.lastSynced).toBeNull();
});
it("discards an old in-flight snapshot that resolves after account switching", async () => {
  const store = useWorkspace();
  await store.initialize();
  let resolve!: (snapshot: Snapshot) => void;
  api.snapshot.mockImplementationOnce(
    () =>
      new Promise<Snapshot>((r) => {
        resolve = r;
      }),
  );
  const oldRefresh = store.refresh(true);
  api.login.mockResolvedValue({ actor: { ...actor, id: "b" } });
  api.snapshot.mockResolvedValue({
    schemaVersion: 1,
    revision: 0,
    projects: [],
    tasks: [],
    activities: [],
  });
  await store.login("b@example.test", "synthetic");
  resolve(createSeed());
  await oldRefresh;
  expect(store.user?.id).toBe("b");
  expect(store.data.projects).toEqual([]);
});
it("deduplicates session retries while a check is pending", async () => {
  const store = useWorkspace();
  const first = store.initialize(),
    second = store.initialize();
  await Promise.all([first, second]);
  expect(api.session).toHaveBeenCalledTimes(1);
});
