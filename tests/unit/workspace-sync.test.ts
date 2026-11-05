import { createSeed } from "../../packages/domain/seed";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWorkspaceSync } from "../../apps/web/src/services/workspace-sync";
import {
  emptyVersions,
  savedWorkspaceEntities,
} from "../../packages/domain/workspace-sync";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("coalesces hints, runs one read at a time, and follows a change arriving during that read", async () => {
  let version = "1",
    finish: () => void = () => {};
  const applied = emptyVersions();
  const meta = vi.fn(async () => ({ ...emptyVersions(), core: version }));
  const apply = vi.fn(async (_domain: string, target: string) => {
    if (target === "1")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    applied.core = target;
  });
  const sync = createWorkspaceSync({
    local: true,
    meta,
    applied: () => applied,
    apply,
    failure: vi.fn(),
  });
  stop = sync.stop;
  sync.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).toHaveBeenCalledTimes(1);
  version = "2";
  sync.hint();
  sync.hint();
  sync.hint();
  await vi.advanceTimersByTimeAsync(150);
  expect(meta).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(meta).toHaveBeenCalledTimes(2);
  expect(applied.core).toBe("2");
  await vi.advanceTimersByTimeAsync(60000);
  expect(meta).toHaveBeenCalledTimes(3);
  expect(apply).toHaveBeenCalledTimes(2);
});
it("does not apply or report an old session response after stopping", async () => {
  let reject: (reason: Error) => void = () => {};
  const apply = vi.fn(),
    failure = vi.fn();
  const sync = createWorkspaceSync({
    local: true,
    meta: () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    applied: emptyVersions,
    apply,
    failure,
  });
  stop = sync.stop;
  sync.start();
  sync.stop();
  reject(new Error("expired old session"));
  await vi.advanceTimersByTimeAsync(0);
  expect(apply).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
});

it("does not merge an account-management response into the project list", () => {
  const user = { id: "user-1", version: 1, name: "A member", role: "admin" };
  const seed = createSeed(),
    project = seed.projects[0]!,
    task = seed.tasks[0]!;
  expect(savedWorkspaceEntities(user)).toEqual([]);
  expect(
    savedWorkspaceEntities({ version: 2, companyName: "Directory" }),
  ).toEqual([]);
  expect(savedWorkspaceEntities([project, task])).toEqual([project, task]);
});
