import { expect, it } from "vitest";
import {
  readFollowing,
  writeFollowing,
} from "../../apps/web/src/services/project-following";
it("stores only bounded unique project IDs and reports invalid data without accepting it", () => {
  const map = new Map<string, string>(),
    storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
  expect(
    writeFollowing("a", ["project-1", "project-1", "project-2"], storage),
  ).toBe(true);
  expect(readFollowing("a", storage)).toEqual({
    ids: ["project-1", "project-2"],
    unavailable: false,
  });
  expect(readFollowing("b", storage)).toEqual({ ids: [], unavailable: false });
  expect(
    writeFollowing(
      "a",
      Array.from({ length: 1001 }, (_, i) => `p-${i}`),
      storage,
    ),
  ).toBe(false);
  expect(readFollowing("a", storage).ids).toHaveLength(2);
  storage.setItem("a", JSON.stringify({ version: 2, ids: ["p"] }));
  expect(readFollowing("a", storage).unavailable).toBe(true);
  storage.setItem("a", "{");
  expect(readFollowing("a", storage).unavailable).toBe(true);
});
it("does not throw when preference storage is blocked", () => {
  const storage = {
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
  };
  expect(readFollowing("a", storage)).toEqual({ ids: [], unavailable: true });
  expect(writeFollowing("a", ["p"], storage)).toBe(false);
});
