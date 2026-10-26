import { expect, it } from "vitest";
import { intakeCandidates } from "../../packages/domain/intake";
import {
  needsIntakeDecision,
  resolveIntakeFieldWarnings,
} from "../../apps/web/src/composables/intake-review";
import { intakeDraftSchema } from "../../apps/web/src/services/intake-drafts";

const source = {
  kind: "text" as const,
  name: "Synthetic decisions",
  sheet: "",
  text: "Project: Synthetic review; Task: Capture the source; Due: someday; Status: unclear; Stage: unclear",
};
const candidate = () => intakeCandidates(source, [])[0]!;

it("clears only explicitly reviewed field warnings and preserves provenance and ambiguity", () => {
  const c = candidate(),
    original = c.sourceText;
  c.matches = ["a", "b"];
  c.targetProjectId = "a";
  c.task!.dueDate = "2026-10-30";
  resolveIntakeFieldWarnings(c, "dueDate");
  expect(c.warnings).not.toContain("Date needs review. Use YYYY-MM-DD.");
  expect(c.warnings).toContain("Unrecognized task status. Choose a status.");
  c.task!.status = "done";
  resolveIntakeFieldWarnings(c, "status");
  resolveIntakeFieldWarnings(c, "stage");
  expect(needsIntakeDecision(c, false)).toBe(true);
  c.matchConfirmed = true;
  expect(needsIntakeDecision(c, false)).toBe(false);
  expect(needsIntakeDecision(c, true)).toBe(true);
  expect(c.sourceText).toBe(original);
});

it("keeps invalid dates pending and allows a deliberately unset date or default status", () => {
  const c = candidate();
  c.task!.dueDate = "2026-02-30";
  resolveIntakeFieldWarnings(c, "dueDate");
  expect(c.warnings).toContain("Date needs review. Use YYYY-MM-DD.");
  c.task!.dueDate = null;
  resolveIntakeFieldWarnings(c, "dueDate");
  resolveIntakeFieldWarnings(c, "status");
  resolveIntakeFieldWarnings(c, "stage");
  expect(needsIntakeDecision(c, false)).toBe(false);
  expect(c.task).toMatchObject({ dueDate: null, status: "todo" });
  expect(c.project.stage).toBe("unclassified");
});

it("does not treat unrelated source conflicts as resolved by changing a field", () => {
  const c = candidate();
  c.warnings.push(
    "Conflicting labels. Review the source and fill the missing fields.",
  );
  for (const field of ["dueDate", "status", "stage"] as const)
    resolveIntakeFieldWarnings(c, field);
  expect(needsIntakeDecision(c, false)).toBe(true);
});

it("requires a task for an existing project but permits a new project with optional fields missing", () => {
  const c = intakeCandidates(
    { ...source, text: "Project: Synthetic new project" },
    [],
  )[0]!;
  expect(needsIntakeDecision(c, false)).toBe(false);
  c.targetProjectId = "existing";
  expect(needsIntakeDecision(c, false)).toBe(true);
  c.selected = false;
  expect(needsIntakeDecision(c, false)).toBe(false);
});

it("retains reviewed fields across draft restoration without restoring write confirmations", () => {
  const c = candidate();
  c.task!.dueDate = "2026-10-30";
  for (const field of ["dueDate", "status", "stage"] as const)
    resolveIntakeFieldWarnings(c, field);
  c.matchConfirmed = true;
  c.duplicateConfirmed = true;
  const restored = intakeDraftSchema.parse({
    version: 1,
    savedAt: Date.now(),
    step: "review",
    source,
    fromFile: false,
    mapping: [],
    hasHeader: true,
    candidates: [c],
  }).candidates[0]!;
  expect(needsIntakeDecision(restored, false)).toBe(false);
  expect(restored).toMatchObject({
    sourceText: source.text,
    matchConfirmed: false,
    duplicateConfirmed: false,
  });
  expect(restored.task?.dueDate).toBe("2026-10-30");
});
