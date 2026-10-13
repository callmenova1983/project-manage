import { afterAll, expect, it } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createSeed } from "../../packages/domain/seed";
import {
  intakeCandidates,
  intakeProvenance,
  planIntake,
  verifyIntakeUndo,
  type IntakeInput,
} from "../../packages/domain/intake";
import type { Project } from "../../packages/domain/types";
interface Expected {
  projectName: string;
  target: string;
  taskTitle: string | null;
  warningIncludes?: string;
  dueDate?: string | null;
  assignee?: string;
  owner?: string;
  client?: string;
  stage?: string;
  status?: string;
  matchCount?: number;
  contextRows?: number[];
}
interface Scenario {
  name: string;
  text: string;
  expected: Expected[];
  projects?: Partial<Project>[];
}
const scenarios = JSON.parse(
  readFileSync("tests/fixtures/intake-scenarios.json", "utf8"),
) as Scenario[];
const passed: string[] = [];
it("keeps exactly 50 explicit synthetic regression scenarios", () =>
  expect(scenarios).toHaveLength(50));
it.each(scenarios)("$name", (fixture) => {
  const seed = createSeed(),
    base = seed.projects[0]!;
  const projects = (
    fixture.projects ?? [
      { id: "atlas", name: "Atlas Customer Portal", aliases: ["Atlas"] },
      { id: "meridian", name: "Meridian Data Platform", aliases: ["Meridian"] },
    ]
  ).map((p) => ({ ...base, aliases: [], ...p }));
  const source = {
    kind: "text" as const,
    name: "Synthetic regression fixture",
    sheet: "",
    text: fixture.text,
  };
  const before = JSON.stringify({ source, projects });
  const candidates = intakeCandidates(source, projects);
  expect(candidates).toHaveLength(fixture.expected.length);
  fixture.expected.forEach((expected, i) => {
    const c = candidates[i]!;
    const { warningIncludes, ...rest } = expected;
    expect({
      projectName: c.project.name,
      target: c.targetProjectId,
      taskTitle: c.task?.title ?? null,
      dueDate: c.task?.dueDate ?? null,
      assignee: c.task?.assignee ?? null,
      owner: c.project.owner,
      client: c.project.client,
      stage: c.project.stage,
      status: c.task?.status ?? null,
      matchCount: c.matches.length,
      contextRows: c.contextRows,
    }).toMatchObject(rest);
    if (warningIncludes)
      expect(c.warnings.some((w) => w.includes(warningIncludes))).toBe(true);
    expect(c.sourceText).toBe(source.text.split(/\r?\n/)[c.sourceRow - 1]);
    expect(c.matchConfirmed).toBe(false);
  });
  expect(JSON.stringify({ source, projects })).toBe(before);
  // Every accepted draft can be created, traced to original text and safely undone.
  let serial = 0;
  const input: IntakeInput = {
    source,
    confirmed: true,
    rows: candidates.map((c) => ({
      sourceRow: c.sourceRow,
      sourcePart: c.sourcePart,
      contextRows: c.contextRows,
      project: c.project,
      task: c.task,
      targetProjectId: c.targetProjectId,
      targetProjectVersion: c.targetProjectVersion,
      duplicateConfirmed: false,
      matchConfirmed: false,
    })),
  };
  const snapshot = { ...seed, projects, tasks: [], activities: [] };
  const batch = planIntake(
    input,
    snapshot,
    "Synthetic reviewer",
    () => `created-${++serial}`,
  );
  expect(batch.source.text).toBe(source.text);
  for (const entry of batch.entries) {
    const proof = intakeProvenance(batch, entry.taskId ?? entry.projectId);
    expect(proof).toContain(source.text.split(/\r?\n/)[entry.sourceRow - 1]);
    for (const row of entry.contextRows ?? [])
      expect(proof).toContain(source.text.split(/\r?\n/)[row - 1]);
  }
  expect(() =>
    verifyIntakeUndo(batch, {
      ...snapshot,
      projects: [...projects, ...batch.projects],
      tasks: batch.tasks,
    }),
  ).not.toThrow();
  passed.push(fixture.name);
});
afterAll(() => {
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/intake-evaluation.json",
    JSON.stringify(
      {
        kind: "Synthetic rule-parser regression; no live model or production accuracy claim",
        scenarioCount: scenarios.length,
        passed: passed.length,
        failed: scenarios
          .filter((s) => !passed.includes(s.name))
          .map((s) => s.name),
        covered: [
          "candidate targets",
          "missing fields",
          "ambiguity",
          "source/context preservation",
          "transaction planning",
          "protected undo",
        ],
        scenarios: passed,
      },
      null,
      2,
    ),
  );
});
