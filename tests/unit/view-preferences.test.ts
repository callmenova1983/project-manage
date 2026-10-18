import { describe, expect, it } from "vitest";
import {
  defaultViewPreferences,
  readViewPreferences,
  writeViewPreferences,
} from "../../apps/web/src/services/view-preferences";
import { accountStorageKey } from "../../apps/web/src/services/account-storage";
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe("private view preferences", () => {
  it("separates account, workspace and runtime mode and round-trips layout and presentation only", () => {
    const local = storage();
    const actor = { id: "a", workspaceId: "one" };
    const key = accountStorageKey("view-preferences", "server", actor);
    const preferences = {
      ...defaultViewPreferences(),
      taskLayout: "calendar" as const,
      projectTaskLayout: "board" as const,
    };
    expect(writeViewPreferences(local, key, preferences)).toBe("");
    expect(readViewPreferences(local, key).value).toEqual(preferences);
    for (const isolated of [
      accountStorageKey("view-preferences", "local", actor),
      accountStorageKey("view-preferences", "server", { ...actor, id: "b" }),
      accountStorageKey("view-preferences", "server", {
        ...actor,
        workspaceId: "two",
      }),
    ])
      expect(readViewPreferences(local, isolated).value.taskLayout).toBe(
        "list",
      );
    expect(local.values.size).toBe(1);
    expect(
      writeViewPreferences(local, key, {
        ...preferences,
        tasks: [{ title: "Business text" }],
      } as typeof preferences),
    ).not.toBe("");
    expect(readViewPreferences(local, key).value).toEqual(preferences);
  });
  it("falls back on malformed, oversized, duplicated or future data and preserves newer formats", () => {
    const local = storage();
    for (const raw of [
      "broken",
      "x".repeat(16001),
      JSON.stringify({
        ...defaultViewPreferences(),
        taskColumns: ["status", "status"],
      }),
      JSON.stringify({ ...defaultViewPreferences(), version: 2 }),
    ]) {
      local.values.set("key", raw);
      const read = readViewPreferences(local, "key");
      expect(read.error).not.toBe("");
      expect(read.value).toEqual(defaultViewPreferences());
      expect(local.values.get("key")).toBe(raw);
    }
    const future = local.values.get("key");
    expect(
      writeViewPreferences(local, "key", defaultViewPreferences()),
    ).not.toBe("");
    expect(local.values.get("key")).toBe(future);
    local.values.set("key", "broken");
    expect(writeViewPreferences(local, "key", defaultViewPreferences())).toBe(
      "",
    );
  });
  it("reports disabled storage and quota failures without claiming a successful save", () => {
    const disabled = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readViewPreferences(disabled, "key").error).not.toBe("");
    expect(
      writeViewPreferences(disabled, "key", defaultViewPreferences()),
    ).not.toBe("");
    const quota = {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
    };
    expect(
      writeViewPreferences(quota, "key", defaultViewPreferences()),
    ).not.toBe("");
  });
});
