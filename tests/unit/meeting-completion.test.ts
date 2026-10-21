import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import type { Proposal, Suggestion } from "../../packages/domain/types";
import {
  emptyMeetingProjectDraft,
  groupMeetingItems,
  meetingNewProjectFields,
  pendingMeetingItems,
  settleMeetingProposal,
  validateMeetingSelection,
} from "../../packages/domain/meeting-completion";
const item = (
  id: string,
  sourceText: string,
  projectName?: string,
): Suggestion => ({
  id,
  sourceLine: 1,
  sourceText,
  title: sourceText,
  candidates: [],
  selectedProjectId: "",
  action: "update",
  status: "in_progress",
  confirmed: false,
  overwriteConfirmed: false,
  ...(projectName ? { sourceHeading: projectName } : {}),
});
it("groups only explicit model labels and never guesses a project from repeated prose", () => {
  const rows = [item("a", "重儿安消调试"), item("b", "重儿照明调试")];
  expect(groupMeetingItems(rows)).toHaveLength(2);
  expect(groupMeetingItems(rows).every((group) => !group.name)).toBe(true);
  const grouped = groupMeetingItems(
    rows.map((row) => ({ ...row, sourceHeading: "模型指定项目" })),
  );
  expect(grouped).toHaveLength(1);
  expect(grouped[0]!.items).toHaveLength(2);
});
it("settles exact selections while preserving pending history and rejects repeated writes", () => {
  const proposal: Proposal = {
    id: "proposal",
    source: "原文",
    sourceVersion: 1,
    status: "draft",
    createdAt: "2026-10-21T00:00:00Z",
    suggestions: [item("a", "一"), item("b", "二")],
  };
  const partial = settleMeetingProposal(
    proposal,
    [{ ...proposal.suggestions[0]!, confirmed: true }],
    { partial: true },
  );
  expect(pendingMeetingItems(partial).map((row) => row.id)).toEqual(["b"]);
  expect(() => validateMeetingSelection(partial, ["a"], [])).toThrow();
  expect(
    settleMeetingProposal(partial, [], { partial: true, skippedIds: ["b"] })
      .status,
  ).toBe("applied");
});
it("keeps manual new-project validation without parsing the user's reply", () => {
  const draft = emptyMeetingProjectDraft();
  expect(draft.name).toBe("");
  const projects = createSeed().projects;
  const channels = [
    { id: "company", name: "公司", shortName: "公司", archived: false },
  ];
  const raw = {
    suggestionId: "a",
    name: projects[0]!.name,
    channelId: "company",
    confirmed: true as const,
  };
  expect(() => meetingNewProjectFields(raw, projects, channels)).toThrow(
    "已有同名项目",
  );
  expect(() =>
    meetingNewProjectFields(
      { ...raw, name: "新项目", channelId: "missing" },
      projects,
      channels,
    ),
  ).toThrow();
});
