import { expect, it } from "vitest";
import {
  editorDraftPrefix,
  editorDraftKey,
  projectEditorDraft,
  taskEditorDraft,
  notesEditorDraft,
  readEditorDraft,
  writeEditorDraft,
  clearEditorDraft,
  clearAccountEditorDrafts,
  EDITOR_DRAFT_TTL,
} from "../../apps/web/src/services/editor-drafts";
import { createSeed as seed } from "../../packages/domain/seed";
import { projectInput, taskInput } from "../../packages/domain/types";
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
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}
it("preserves incomplete fields, aliases, whitespace and version without confirming or saving", () => {
  const storage = memory(),
    fields = projectInput.strip().parse(seed().projects[0]);
  fields.name = "";
  fields.client = "  unfinished  ";
  const value = { fields, aliases: "  first, unfinished  " };
  expect(
    writeEditorDraft(
      "p",
      projectEditorDraft,
      { version: 1, savedAt: 100000, baseVersion: 7, attempted: false, value },
      storage,
    ),
  ).toBe(true);
  expect(
    readEditorDraft("p", projectEditorDraft, 100001, storage),
  ).toMatchObject({
    kind: "ready",
    draft: { baseVersion: 7, attempted: false, value },
  });
  const task = taskInput.strip().parse(seed().tasks[0]);
  task.title = "";
  task.dueDate = "";
  expect(
    writeEditorDraft(
      "t",
      taskEditorDraft,
      {
        version: 1,
        savedAt: 100000,
        baseVersion: 2,
        attempted: false,
        value: task,
      },
      storage,
    ),
  ).toBe(true);
  expect(readEditorDraft("t", taskEditorDraft, 100001, storage)).toMatchObject({
    kind: "ready",
    draft: { value: { title: "", dueDate: "" } },
  });
});
it("isolates modes, accounts, workspaces, projects, task parents and editor kinds", () => {
  const actor = { workspaceId: "w", id: "a" },
    prefix = editorDraftPrefix("server", actor);
  const keys = [
    editorDraftKey(prefix, "project", "p1", "p1"),
    editorDraftKey(prefix, "notes", "p1", "p1"),
    editorDraftKey(prefix, "task", "p1", ""),
    editorDraftKey(prefix, "task", "p2", ""),
    editorDraftKey(prefix, "task", "p1", "", "parent"),
    editorDraftKey(editorDraftPrefix("local", actor), "project", "p1", "p1"),
    editorDraftKey(
      editorDraftPrefix("server", { ...actor, id: "b" }),
      "project",
      "p1",
      "p1",
    ),
    editorDraftKey(
      editorDraftPrefix("server", { ...actor, workspaceId: "other" }),
      "project",
      "p1",
      "p1",
    ),
  ];
  expect(new Set(keys).size).toBe(keys.length);
});
it("clears only the signed-out account and expires old drafts on reading", () => {
  const storage = memory(),
    a = editorDraftPrefix("server", { workspaceId: "w", id: "a" }),
    b = editorDraftPrefix("server", { workspaceId: "w", id: "b" });
  for (const key of [a + "one", a + "two", b + "one"])
    writeEditorDraft(
      key,
      notesEditorDraft,
      {
        version: 1,
        savedAt: 100000,
        baseVersion: 1,
        attempted: false,
        value: "private synthetic notes",
      },
      storage,
    );
  expect(clearAccountEditorDrafts(a, storage)).toBe(true);
  expect(storage.length).toBe(1);
  expect(
    readEditorDraft(b + "one", notesEditorDraft, 100001, storage).kind,
  ).toBe("ready");
  expect(
    readEditorDraft(
      b + "one",
      notesEditorDraft,
      100001 + EDITOR_DRAFT_TTL,
      storage,
    ).kind,
  ).toBe("expired");
  expect(storage.length).toBe(0);
});
it("keeps corrupt, oversized or future records for explicit discard", () => {
  const storage = memory();
  for (const raw of [
    "{",
    "x".repeat(100001),
    JSON.stringify({
      version: 2,
      savedAt: 1,
      baseVersion: 1,
      attempted: false,
      value: "text",
    }),
    JSON.stringify({
      version: 1,
      savedAt: 99999999,
      baseVersion: 1,
      attempted: false,
      value: "text",
    }),
  ]) {
    storage.setItem("a", raw);
    expect(readEditorDraft("a", notesEditorDraft, 100000, storage).kind).toBe(
      "invalid",
    );
    expect(storage.getItem("a")).toBe(raw);
  }
  expect(clearEditorDraft("a", storage)).toBe(true);
  expect(storage.length).toBe(0);
});
it("preserves uncertain-save markers across refresh and never invents a version", () => {
  const storage = memory();
  writeEditorDraft(
    "a",
    notesEditorDraft,
    {
      version: 1,
      savedAt: 100000,
      baseVersion: null,
      attempted: true,
      value: "synthetic pending",
    },
    storage,
  );
  expect(readEditorDraft("a", notesEditorDraft, 100001, storage)).toMatchObject(
    { kind: "ready", draft: { baseVersion: null, attempted: true } },
  );
});
it("handles blocked storage without throwing or truncating data", () => {
  const storage = {
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
    removeItem: () => {
      throw Error();
    },
    key: () => {
      throw Error();
    },
    length: 1,
  };
  expect(readEditorDraft("a", notesEditorDraft, 1, storage).kind).toBe(
    "unavailable",
  );
  expect(
    writeEditorDraft(
      "a",
      notesEditorDraft,
      { version: 1, savedAt: 1, baseVersion: 1, attempted: false, value: "x" },
      storage,
    ),
  ).toBe(false);
  expect(clearEditorDraft("a", storage)).toBe(false);
  expect(clearAccountEditorDrafts("a", storage)).toBe(false);
});
