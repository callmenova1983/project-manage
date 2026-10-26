import {
  normalizeName,
  type IntakeCandidate,
} from "../../../../packages/domain/intake";
import { dateSchema } from "../../../../packages/domain/types";

const fieldWarnings = {
  dueDate: [
    "Date needs review. Use YYYY-MM-DD.",
    "Relative dates stay unset. Choose a date after reviewing the source.",
  ],
  status: ["Unrecognized task status. Choose a status."],
  stage: ["Unrecognized stage. Choose a stage."],
};
/** Resolve only a committed field choice, never a partial keystroke or unrelated warning. */
export function resolveIntakeFieldWarnings(
  c: IntakeCandidate,
  field: keyof typeof fieldWarnings,
) {
  if (field !== "stage" && !c.task) return;
  if (
    field === "dueDate" &&
    c.task?.dueDate !== null &&
    !dateSchema.safeParse(c.task?.dueDate).success
  )
    return;
  c.warnings = c.warnings.filter(
    (warning) => !fieldWarnings[field].includes(warning),
  );
}
/** Capture grouping when review opens so typing a project name never remounts its input. */
export function groupIntakeCandidates(rows: IntakeCandidate[]) {
  const groups = new Map<
    string,
    { id: string; name: string; rows: IntakeCandidate[] }
  >();
  for (const row of rows) {
    const key = row.targetProjectId || normalizeName(row.project.name);
    if (!groups.has(key))
      groups.set(key, { id: row.id, name: row.project.name, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}
export function needsIntakeDecision(c: IntakeCandidate, duplicate: boolean) {
  if (!c.selected) return false;
  return (
    !c.project.name.trim() ||
    (!!c.targetProjectId && !c.task) ||
    (c.task && !c.task.title.trim()) ||
    (!c.targetProjectId && !!c.project.intakeInbox) ||
    (c.matches.length > 1 && !c.matchConfirmed) ||
    (duplicate && !c.duplicateConfirmed) ||
    c.warnings.some(
      (w) =>
        ![
          "Rule-assisted draft. Review the project details.",
          "Several projects match. Choose the target.",
          "Partial project match. Confirm the target or keep it in Intake inbox.",
          "Unresolved project. Save in Intake inbox and assign it later.",
        ].includes(w),
    )
  );
}
