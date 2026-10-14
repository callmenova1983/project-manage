import { expect, it } from "vitest";
import { accountStorageKey } from "../../apps/web/src/services/account-storage";
import {
  readMappingTemplates,
  saveMappingTemplates,
  reuseMapping,
  type MappingTemplate,
} from "../../apps/web/src/services/intake-mappings";
import {
  groupIntakeCandidates,
  needsIntakeDecision,
} from "../../apps/web/src/composables/intake-review";
import { intakeCandidates } from "../../packages/domain/intake";
const template: MappingTemplate = {
  id: "one",
  name: "Weekly sheet",
  hasHeader: true,
  columns: [
    { header: "Work", field: "task" },
    { header: "Account", field: "project" },
  ],
};
it("reuses headers across reordered files while rejecting guesses for missing and duplicated names", () => {
  expect(reuseMapping(template, ["Account", "WORK", "Unknown"])).toEqual([
    "project",
    "task",
    "ignore",
  ]);
  expect(reuseMapping(template, ["Work", "Work", "Account"])).toEqual([
    "ignore",
    "ignore",
    "project",
  ]);
  expect(
    reuseMapping(
      {
        ...template,
        columns: [
          { header: "", field: "task" },
          { header: "", field: "project" },
        ],
      },
      ["", ""],
    ),
  ).toEqual(["ignore", "ignore"]);
  expect(
    reuseMapping({ ...template, hasHeader: false }, [
      "task value",
      "project value",
    ]),
  ).toEqual(["task", "project"]);
  expect(() =>
    reuseMapping({ ...template, hasHeader: false }, ["one"]),
  ).toThrow("same number");
});
it("persists bounded validated templates under separate account/workspace/mode keys", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    };
  const actor = { id: "a", workspaceId: "w" };
  const keys = [
    accountStorageKey("column-mappings", "server", actor),
    accountStorageKey("column-mappings", "local", actor),
    accountStorageKey("column-mappings", "server", { ...actor, id: "b" }),
    accountStorageKey("column-mappings", "server", {
      ...actor,
      workspaceId: "other",
    }),
  ];
  expect(new Set(keys).size).toBe(4);
  expect(saveMappingTemplates(keys[0]!, [template], storage)).toBe(true);
  expect(readMappingTemplates(keys[0]!, storage).templates).toEqual([template]);
  expect(readMappingTemplates(keys[1]!, storage).templates).toEqual([]);
  expect(
    saveMappingTemplates(keys[0]!, Array(21).fill(template), storage),
  ).toBe(false);
  expect(readMappingTemplates(keys[0]!, storage).templates).toHaveLength(1);
  storage.setItem(keys[0]!, "{");
  expect(readMappingTemplates(keys[0]!, storage).unavailable).toBe(true);
  const blocked = {
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
  };
  expect(readMappingTemplates("a", blocked).unavailable).toBe(true);
  expect(saveMappingTemplates("a", [template], blocked)).toBe(false);
});
it("groups source rows without merging provenance or skipping unresolved confirmations", () => {
  const rows = intakeCandidates(
    {
      kind: "text",
      name: "Synthetic",
      sheet: "",
      text: "Project: Test; Task: First\nProject: Else; Task: Second\nProject: Test; Task: Third",
    },
    [],
  );
  const groups = groupIntakeCandidates(rows);
  expect(groups.map((g) => g.rows.map((c) => c.sourceRow))).toEqual([
    [1, 3],
    [2],
  ]);
  const original = structuredClone(rows),
    first = rows[0]!;
  expect(needsIntakeDecision(first, false)).toBe(false);
  first.matches = ["a", "b"];
  first.targetProjectId = "a";
  expect(needsIntakeDecision(first, false)).toBe(true);
  first.matchConfirmed = true;
  expect(needsIntakeDecision(first, false)).toBe(false);
  expect(needsIntakeDecision(first, true)).toBe(true);
  first.duplicateConfirmed = true;
  expect(needsIntakeDecision(first, true)).toBe(false);
  first.project.name = "Typing";
  expect(groups[0]!.name).toBe("Test");
  expect(rows.map((r) => r.sourceText)).toEqual(
    original.map((r) => r.sourceText),
  );
  expect(rows.every((r) => r.selected)).toBe(true);
});
