import { describe, it, expect } from "vitest";
import { intakeCandidates } from "../../packages/domain/intake";
import {
  intakeDraftKey,
  writeIntakeDraft,
  readIntakeDraft,
  clearIntakeDraft,
  DRAFT_TTL,
  DRAFT_MAX_LENGTH,
  type IntakeDraft,
} from "../../apps/web/src/services/intake-drafts";
const source = {
  kind: "text" as const,
  name: "Pasted text",
  sheet: "",
  text: "项目：合成项目；任务：审阅文案\n原文  保留空白",
};
function fixture(): IntakeDraft {
  const candidates = intakeCandidates(source, []);
  candidates[0]!.task!.title = "  尚未完成的编辑  ";
  candidates[0]!.project.name = "";
  candidates[0]!.duplicateConfirmed = true;
  return {
    version: 1,
    savedAt: 100000,
    step: "review",
    source,
    fromFile: false,
    mapping: [],
    hasHeader: true,
    candidates,
  };
}
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
describe("temporary intake drafts", () => {
  it("preserves exact source, incomplete edits and target versions but resets confirmations", () => {
    const storage = memory(),
      draft = fixture();
    draft.candidates[0]!.targetProjectVersion = 7;
    expect(writeIntakeDraft("a", draft, storage)).toBe(true);
    const result = readIntakeDraft("a", 100001, storage);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error();
    expect(result.draft.source).toEqual(source);
    expect(result.draft.candidates[0]).toMatchObject({
      project: { name: "" },
      task: { title: "  尚未完成的编辑  " },
      targetProjectVersion: 7,
      duplicateConfirmed: false,
    });
    expect(storage.getItem("a")).not.toContain('"confirmed":');
  });
  it("isolates modes, workspaces and actors without email or credentials", () => {
    const a = { id: "member", workspaceId: "work" };
    expect(
      new Set([
        intakeDraftKey("local", a),
        intakeDraftKey("server", a),
        intakeDraftKey("server", { ...a, id: "other" }),
        intakeDraftKey("server", { ...a, workspaceId: "other" }),
      ]).size,
    ).toBe(4);
  });
  it("expires old drafts and clears only the requested account", () => {
    const storage = memory();
    writeIntakeDraft("a", fixture(), storage);
    writeIntakeDraft("b", fixture(), storage);
    expect(readIntakeDraft("a", 100001 + DRAFT_TTL, storage).kind).toBe(
      "expired",
    );
    expect(storage.getItem("a")).toBeNull();
    expect(readIntakeDraft("b", 100001, storage).kind).toBe("ready");
    expect(clearIntakeDraft("b", storage)).toBe(true);
    expect(readIntakeDraft("b", 100001, storage).kind).toBe("none");
  });
  it("keeps corrupt or future-version data for explicit discard", () => {
    const storage = memory();
    for (const raw of [
      "{",
      JSON.stringify({ ...fixture(), version: 2 }),
      JSON.stringify({ ...fixture(), savedAt: 999999 }),
      "x".repeat(DRAFT_MAX_LENGTH + 1),
    ]) {
      storage.setItem("a", raw);
      expect(readIntakeDraft("a", 100001, storage).kind).toBe("invalid");
      expect(storage.getItem("a")).toBe(raw);
    }
  });
  it("reports quota/policy failures without throwing or truncating a prior draft", () => {
    const storage = {
      getItem: () => {
        throw new Error();
      },
      setItem: () => {
        throw new Error();
      },
      removeItem: () => {
        throw new Error();
      },
    };
    expect(writeIntakeDraft("a", fixture(), storage)).toBe(false);
    expect(readIntakeDraft("a", 100001, storage).kind).toBe("unavailable");
    expect(clearIntakeDraft("a", storage)).toBe(false);
  });
});
