import { describe, expect, it } from "vitest";
import { reorderedProjectIds } from "../../packages/domain/project-order";
describe("project row placement", () => {
  it("keeps all hidden projects when moving filtered visible rows", () => {
    const ids = ["a", "hidden-one", "b", "hidden-two", "c"];
    const before = [...ids];
    const next = reorderedProjectIds(ids, "c", "a", false)!;
    expect(next).toEqual(["c", "a", "hidden-one", "b", "hidden-two"]);
    expect(new Set(next)).toEqual(new Set(ids));
    expect(ids).toEqual(before);
  });
  it("returns no write plan for identical placement, self drops and unknown rows", () => {
    expect(reorderedProjectIds(["a", "b", "c"], "a", "b", false)).toBeNull();
    expect(reorderedProjectIds(["a", "b", "c"], "b", "a", true)).toBeNull();
    expect(reorderedProjectIds(["a", "b"], "a", "a", true)).toBeNull();
    expect(reorderedProjectIds(["a", "b"], "a", "missing", false)).toBeNull();
    expect(reorderedProjectIds(["a", "a", "b"], "a", "b", false)).toBeNull();
  });
  it("places before and after without ever planning an entity merge", () => {
    expect(reorderedProjectIds(["a", "b", "c"], "a", "c", false)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(reorderedProjectIds(["a", "b", "c"], "a", "c", true)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});
