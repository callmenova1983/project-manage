import { describe, expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import {
  detectColumns,
  intakeCandidates,
  intakeProvenance,
  parseDelimited,
  planIntake,
  verifyIntakeUndo,
  type IntakeInput,
} from "../../packages/domain/intake";
const seed = createSeed();
const rows = [
  ["Project", "Client", "Task", "Due date"],
  ["星河门户", "星河", "确认文案", "2026-10-20"],
  ["星河门户", "星河", "评审页面", ""],
];
const source = {
  kind: "csv" as const,
  name: "table.csv",
  sheet: "",
  text: rows.map((row) => row.join(",")).join("\n"),
  rows,
};
function input(): IntakeInput {
  return {
    source,
    confirmed: true,
    rows: intakeCandidates(source, seed.projects).map((row) => ({
      sourceRow: row.sourceRow,
      targetProjectId: row.targetProjectId,
      targetProjectVersion: row.targetProjectVersion,
      project: row.project,
      task: row.task,
      duplicateConfirmed: false,
    })),
  };
}
describe("explicit structured import", () => {
  it("keeps exact table provenance and creates no implicit schedules", () => {
    const batch = planIntake(input(), seed, "Member", () =>
      crypto.randomUUID(),
    );
    expect(batch.projects).toHaveLength(1);
    expect(batch.tasks).toHaveLength(2);
    expect(batch.tasks[0]).toMatchObject({
      dueDate: "2026-10-20",
      workWeek: null,
    });
    expect(intakeProvenance(batch, batch.tasks[0]!.id)).toContain("确认文案");
  });
  it("preserves quoted CSV and validates explicit column mapping", () => {
    expect(
      parseDelimited('Project,Task\n"Acme, Inc","Line 1\nLine 2"'),
    ).toEqual([
      ["Project", "Task"],
      ["Acme, Inc", "Line 1\nLine 2"],
    ]);
    expect(() => parseDelimited('"broken')).toThrow();
    expect(detectColumns(["项目名称", "客户", "负责人", "待办"])).toEqual([
      "project",
      "client",
      "owner",
      "task",
    ]);
  });
  it("refuses raw prose instead of guessing fields or making an inbox task", () => {
    expect(() =>
      intakeCandidates(
        {
          kind: "text",
          name: "notes",
          sheet: "",
          text: "客户名字重庆市市院，数字城市项目",
        },
        seed.projects,
      ),
    ).toThrow("AI 助手");
  });
  it("retains ambiguous table-name matches for explicit selection", () => {
    const p = seed.projects[0]!;
    const candidates = intakeCandidates(
      {
        ...source,
        rows: [
          ["Project", "Task"],
          [p.name, "new work"],
        ],
      },
      [p, { ...p, id: "other" }],
    );
    expect(candidates[0]!.matches).toHaveLength(2);
    expect(candidates[0]!.targetProjectId).toBe("");
  });
  it("rejects repeated rows and only undoes unchanged imported creations", () => {
    const data = input();
    expect(() =>
      planIntake(
        { ...data, rows: [data.rows[0]!, data.rows[0]!] },
        seed,
        "Member",
        () => crypto.randomUUID(),
      ),
    ).toThrow();
    const batch = planIntake(data, seed, "Member", () => crypto.randomUUID());
    const snapshot = {
      ...seed,
      projects: [...seed.projects, ...batch.projects],
      tasks: [...seed.tasks, ...batch.tasks],
    };
    expect(() => verifyIntakeUndo(batch, snapshot)).not.toThrow();
    expect(() =>
      verifyIntakeUndo(batch, {
        ...snapshot,
        projects: snapshot.projects.map((project) =>
          project.id === batch.projects[0]!.id
            ? { ...project, version: 2 }
            : project,
        ),
      }),
    ).toThrow();
  });
});
