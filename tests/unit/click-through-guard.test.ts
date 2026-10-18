import { describe, expect, it } from "vitest";
import { createClickThroughGuard } from "../../apps/web/src/services/click-through-guard";

describe("click-through protection", () => {
  function click(
    target: { isConnected: boolean },
    detail = 1,
    timeStamp = 100,
  ) {
    return { target, detail, timeStamp, clientX: 100, clientY: 24 };
  }
  it("allows rapid repeated activation of persistent controls and navigation", () => {
    const guard = createClickThroughGuard();
    const projects = { isConnected: true },
      tasks = { isConnected: true };
    expect(guard(click(projects))).toBe(false);
    expect(guard(click(tasks, 2, 150))).toBe(false);
    expect(guard(click(projects, 3, 200))).toBe(false);
    expect(guard(click(projects, 4, 250))).toBe(false);
  });
  it("blocks a double click landing underneath a just-closed editor", () => {
    const guard = createClickThroughGuard();
    const save = { isConnected: true },
      underlying = { isConnected: true };
    guard(click(save));
    save.isConnected = false;
    expect(guard(click(underlying, 2, 180))).toBe(true);
    expect(guard(click(underlying, 3, 220))).toBe(true);
  });
  it("allows intentional movement and a later single click after an editor closes", () => {
    const guard = createClickThroughGuard();
    const save = { isConnected: true },
      nav = { isConnected: true };
    guard(click(save));
    save.isConnected = false;
    expect(guard({ ...click(nav, 2, 180), clientX: 160 })).toBe(false);
    expect(guard(click(nav, 1, 220))).toBe(false);
  });
  it("does not block keyboard activation or stale repeated-click counts", () => {
    const guard = createClickThroughGuard();
    const old = { isConnected: true },
      next = { isConnected: true };
    guard(click(old));
    old.isConnected = false;
    expect(guard(click(next, 0, 180))).toBe(false);
    expect(guard(click(next, 2, 1000))).toBe(false);
  });
});
