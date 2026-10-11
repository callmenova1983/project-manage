import { describe, it, expect } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  intakeCandidates,
  parseDelimited,
  detectColumns,
  planIntake,
  verifyIntakeUndo,
  intakeProvenance,
  type IntakeInput,
  type IntakeSource,
} from "../../packages/domain/intake";
const seed = createSeed();
const source: IntakeSource = {
  kind: "text",
  name: "notes.txt",
  sheet: "",
  text: "项目：星河门户；客户：星河；负责人：林晓；阶段：实施中；任务：确认文案；截止日期：2026-10-20\n项目：星河门户；客户：星河；负责人：林晓；阶段：实施中；任务：评审页面",
};
function input(s = source): IntakeInput {
  return {
    source: s,
    confirmed: true,
    rows: intakeCandidates(s, seed.projects).map((c) => ({
      sourceRow: c.sourceRow,
      targetProjectId: c.targetProjectId,
      targetProjectVersion: c.targetProjectVersion,
      project: c.project,
      task: c.task,
      duplicateConfirmed: false,
    })),
  };
}
let serial = 0;
const id = () => `new-${++serial}`;
describe("reviewed project intake", () => {
  it("parses labeled Chinese text, groups a project and keeps exact line provenance", () => {
    const batch = planIntake(input(), seed, "Member", id);
    expect(batch.projects).toHaveLength(1);
    expect(batch.tasks).toHaveLength(2);
    expect(batch.projects[0]?.stage).toBe("implementation");
    expect(batch.tasks[0]?.dueDate).toBe("2026-10-20");
    expect(batch.tasks[0]?.workWeek).toBeNull();
    expect(intakeProvenance(batch, batch.tasks[0]!.id)).toContain(
      source.text.split("\n")[0],
    );
  });
  it("keeps quoted CSV newlines/commas and rejects unclosed quotes", () => {
    expect(
      parseDelimited(
        'Project,Client,Task\n"Portal","Acme, Inc","Line 1\nLine 2"',
      ),
    ).toEqual([
      ["Project", "Client", "Task"],
      ["Portal", "Acme, Inc", "Line 1\nLine 2"],
    ]);
    expect(() => parseDelimited('"broken')).toThrow("Unclosed");
    expect(detectColumns(["项目名称", "客户", "负责人", "待办"])).toEqual([
      "project",
      "client",
      "owner",
      "task",
    ]);
  });
  it("matches aliases but leaves ambiguous projects for review", () => {
    const p = seed.projects[0]!;
    const s = { ...source, text: `Project: ${p.name}; Task: new work` };
    const c = intakeCandidates(s, [p, { ...p, id: "second" }])[0]!;
    expect(c.matches).toHaveLength(2);
    expect(c.targetProjectId).toBe("");
    expect(c.warnings).toContain("Several projects match. Choose the target.");
  });
  it("flags impossible/relative dates and unknown stages without inventing a due date", () => {
    const c = intakeCandidates(
      {
        ...source,
        text: "项目：New；客户：Acme；阶段：unknown；任务：Review；日期：明天",
      },
      [],
    )[0]!;
    expect(c.task?.dueDate).toBeNull();
    expect(c.warnings).toHaveLength(2);
  });
  it("requires explicit duplicate confirmation and detects stale targets", () => {
    const p = seed.projects[0]!,
      task = seed.tasks.find((t) => t.projectId === p.id)!;
    const parsed = input({
      ...source,
      text: `Project: ${p.name}; Task: ${task.title}`,
    });
    expect(() => planIntake(parsed, seed, "Member", id)).toThrow(
      "Duplicate task",
    );
    parsed.rows[0]!.duplicateConfirmed = true;
    expect(planIntake(parsed, seed, "Member", id).projects).toHaveLength(0);
    parsed.rows[0]!.targetProjectVersion = 99;
    expect(() => planIntake(parsed, seed, "Member", id)).toThrow("changed");
  });
  it("blocks same-name creation, inconsistent rows, duplicate source and empty apply", () => {
    const p = seed.projects[0]!;
    const parsed = input({
      ...source,
      text: `Project: ${p.name}; Client: ${p.client}; Task: Unique`,
    });
    parsed.rows[0]!.targetProjectId = "";
    expect(() => planIntake(parsed, seed, "Member", id)).toThrow(
      "existing name",
    );
    const grouped = input();
    grouped.rows[1]!.project.owner = "Different";
    expect(() => planIntake(grouped, seed, "Member", id)).toThrow(
      "different details",
    );
    expect(() =>
      planIntake({ ...input(), rows: [] }, seed, "Member", id),
    ).toThrow();
  });
  it("undo removes only unchanged creations and protects subsequent edits/dependencies", () => {
    const batch = planIntake(input(), seed, "Member", id);
    const snapshot = {
      ...seed,
      projects: [...seed.projects, ...batch.projects],
      tasks: [...seed.tasks, ...batch.tasks],
    };
    expect(() => verifyIntakeUndo(batch, snapshot)).not.toThrow();
    expect(() =>
      verifyIntakeUndo(batch, {
        ...snapshot,
        tasks: [...snapshot.tasks, { ...batch.tasks[0]!, id: "later" }],
      }),
    ).toThrow("depend");
    expect(() =>
      verifyIntakeUndo(batch, {
        ...snapshot,
        projects: snapshot.projects.map((p) =>
          p.id === batch.projects[0]!.id ? { ...p, version: 2 } : p,
        ),
      }),
    ).toThrow("changed");
  });
});
