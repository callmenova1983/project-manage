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
      sourcePart: c.sourcePart,
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

describe("progressive capture with synthetic ambiguous notes (rules, not live LLM)", () => {
  it("saves one recognizable item with no invented person, date or business stage", () => {
    const s = { ...source, text: "整理下次讨论要点" };
    const candidate = intakeCandidates(s, [])[0]!;
    expect(candidate.project).toMatchObject({
      name: "Intake inbox",
      client: "",
      owner: "Unassigned",
      stage: "unclassified",
    });
    expect(candidate.task).toMatchObject({
      title: s.text,
      assignee: "Unassigned",
      dueDate: null,
      workWeek: null,
    });
    const batch = planIntake(input(s), seed, "Member", id);
    expect(batch.tasks).toHaveLength(1);
    expect(intakeProvenance(batch, batch.tasks[0]!.id)).toContain(s.text);
  });
  it("retains two explicit task labels on one source line and groups across projects", () => {
    const s = {
      ...source,
      text: "项目：春河；任务：确认文案；任务：整理清单；项目：秋原；任务：准备讨论",
    };
    const parsed = input(s),
      batch = planIntake(parsed, seed, "Member", id);
    expect(batch.projects.map((p) => p.name)).toEqual(["春河", "秋原"]);
    expect(batch.tasks.map((t) => t.title)).toEqual([
      "确认文案",
      "整理清单",
      "准备讨论",
    ]);
    expect(batch.tasks[0]!.projectId).toBe(batch.tasks[1]!.projectId);
    expect(batch.tasks[2]!.projectId).not.toBe(batch.tasks[0]!.projectId);
    for (const task of batch.tasks)
      expect(intakeProvenance(batch, task.id)).toContain(s.text);
  });
  it("keeps partial and conflicting project names unresolved instead of guessing", () => {
    const p = seed.projects[0]!,
      projects = [
        { ...p, name: "星河门户", aliases: ["星河"] },
        { ...p, id: "other", name: "星河运营", aliases: ["星河"] },
      ];
    const ambiguous = intakeCandidates(
      { ...source, text: "项目：星河；任务：讨论方案" },
      projects,
    )[0]!;
    expect(ambiguous.matches).toHaveLength(2);
    expect(ambiguous.targetProjectId).toBe("");
    expect(ambiguous.project.name).toBe("Intake inbox");
    const partial = intakeCandidates(
      { ...source, text: "项目：星河门；任务：讨论方案" },
      projects,
    )[0]!;
    expect(partial.matches).toEqual([p.id]);
    expect(partial.targetProjectId).toBe("");
  });
  it.each([
    "明天",
    "下周五",
    "tomorrow Pacific/Auckland",
    "2026-02-30",
    "2026-10-12 or 2026-10-13",
  ])(
    "retains ambiguous date %s without resolving timezone or contradictions",
    (date) => {
      const c = intakeCandidates(
        { ...source, text: `任务：确认评审；日期：${date}` },
        [],
      )[0]!;
      expect(c.task!.dueDate).toBeNull();
      expect(c.warnings).toContain("Date needs review. Use YYYY-MM-DD.");
      expect(c.sourceText).toContain(date);
    },
  );
  it("accepts a task-only table and reuses the existing pending inbox", () => {
    const first = planIntake(
      input({ ...source, text: "准备合成记录" }),
      seed,
      "Member",
      id,
    );
    const table = {
      ...source,
      kind: "csv" as const,
      text: "Task\nReview",
      rows: [["Task"], ["Review"]],
    };
    const c = intakeCandidates(table, first.projects)[0]!;
    expect(c.targetProjectId).toBe(first.projects[0]!.id);
    expect(c.task!.title).toBe("Review");
  });
});

it.each([0, 1, 2])(
  "merges distributed missing details regardless of the complete row position (%s)",
  (position) => {
    const lines = [
      "项目：新合成项目；任务：第一项",
      "项目：新合成项目；任务：第二项",
    ];
    lines.splice(
      position,
      0,
      "项目：新合成项目；客户：合成客户；负责人：合成负责人；阶段：实施中；任务：第三项",
    );
    const batch = planIntake(
      input({ ...source, text: lines.join("\n") }),
      seed,
      "Member",
      id,
    );
    expect(batch.projects).toHaveLength(1);
    expect(batch.tasks).toHaveLength(3);
    expect(batch.projects[0]).toMatchObject({
      client: "合成客户",
      owner: "合成负责人",
      stage: "implementation",
    });
    expect(new Set(batch.tasks.map((t) => t.projectId)).size).toBe(1);
    expect(batch.tasks.every((t) => t.assignee === "Unassigned")).toBe(true);
  },
);
it.each([
  "客户：另一客户",
  "负责人：另一负责人",
  "阶段：潜在需求",
  "描述：不同的描述",
])(
  "rejects conflicting known facts (%s) instead of creating another project or picking a winner",
  (conflict) => {
    const s = {
      ...source,
      text: `项目：同名项目；客户：原客户；负责人：原负责人；阶段：实施中；描述：原描述；任务：第一项\n项目：同名项目；${conflict}；任务：第二项`,
    };
    expect(() => planIntake(input(s), seed, "Member", id)).toThrow(
      "different details",
    );
  },
);
it("keeps distinct unknown-project notes in a neutral inbox without merging their business facts", () => {
  const s = {
    ...source,
    text: "任务：第一项；客户：甲；负责人：李；描述：第一项上下文\n任务：第二项；客户：乙；负责人：王；描述：第二项上下文",
  };
  const batch = planIntake(input(s), seed, "Member", id);
  expect(batch.projects).toHaveLength(1);
  expect(batch.projects[0]).toMatchObject({
    intakeInbox: true,
    client: "",
    owner: "Unassigned",
    stage: "unclassified",
    description: "",
  });
  expect(batch.tasks.map((t) => t.description)).toEqual([
    "第一项上下文",
    "第二项上下文",
  ]);
  expect(intakeProvenance(batch, batch.tasks[1]!.id)).toContain("负责人：王");
});
it("saves a name-only project and retains ambiguous project-only notes as actionable inbox items", () => {
  const batch = planIntake(
    input({ ...source, text: "项目：只确定了名字" }),
    seed,
    "Member",
    id,
  );
  expect(batch.projects[0]).toMatchObject({
    name: "只确定了名字",
    client: "",
    stage: "unclassified",
  });
  const p = seed.projects[0]!,
    c = intakeCandidates({ ...source, text: `项目：${p.name}` }, [
      p,
      { ...p, id: "ambiguous" },
    ])[0]!;
  expect(c.project.intakeInbox).toBe(true);
  expect(c.task!.title).toContain(p.name);
});

it("requires a second ambiguity confirmation and retains section provenance without overwriting projects", () => {
  const s = { ...source, text: "Atlas:\n- Coordinate Meridian" },
    parsed = input(s),
    row = parsed.rows[0]!;
  const p = seed.projects[0]!;
  row.targetProjectId = p.id;
  row.targetProjectVersion = p.version;
  expect(() => planIntake(parsed, seed, "Synthetic", id)).toThrow(
    "Confirm the target",
  );
  row.matchConfirmed = true;
  const batch = planIntake(parsed, seed, "Synthetic", id);
  expect(batch.projects).toEqual([]);
  expect(batch.tasks).toHaveLength(1);
  expect(batch.tasks[0]!.projectId).toBe(p.id);
  expect(batch.entries[0]!.contextRows).toEqual([1]);
  const proof = intakeProvenance(batch, batch.tasks[0]!.id);
  expect(proof).toContain("Row 1: Atlas:");
  expect(proof).toContain("Row 2: - Coordinate Meridian");
  expect(() =>
    verifyIntakeUndo(batch, {
      ...seed,
      tasks: [...seed.tasks, ...batch.tasks],
    }),
  ).not.toThrow();
  expect(seed.projects[0]).toEqual(p);
});
it("rejects nonexistent provenance rows and too many section context lines", () => {
  const parsed = input({ ...source, text: "Project: New\n- Review" });
  parsed.rows[0]!.contextRows = [999];
  expect(() => planIntake(parsed, seed, "Synthetic", id)).toThrow(
    "Source row is missing",
  );
  expect(() =>
    intakeCandidates(
      {
        ...source,
        text: "Project: New\n" + "Owner: Same\n".repeat(21) + "- Review",
      },
      [],
    ),
  ).toThrow("Too many context lines");
});
it("handles an unlabeled task followed by explicit assignee metadata without dropping its title", () => {
  const c = intakeCandidates(
    { ...source, text: "Project: New\n- Review the copy; Assignee: Robin" },
    [],
  )[0]!;
  expect(c.task?.title).toBe("Review the copy");
  expect(c.task?.assignee).toBe("Robin");
  expect(c.contextRows).toEqual([1]);
});

it("preserves commas and unlabeled task continuations, while exposing conflicting section metadata", () => {
  const c = intakeCandidates(
    {
      ...source,
      text: "Project: New; Client: Acme, Inc; Task: Review copy, layout; then send the brief",
    },
    [],
  )[0]!;
  expect(
    intakeCandidates(
      { ...source, text: "Please review Atlas" },
      seed.projects,
    )[0]!.matchEvidence,
  ).toEqual([
    { projectId: seed.projects[0]!.id, kind: "mention", value: "Atlas" },
  ]);
  expect(c.project.client).toBe("Acme, Inc");
  expect(c.task?.title).toBe("Review copy, layout; then send the brief");
  const conflict = intakeCandidates(
    { ...source, text: "Project: New\nOwner: Robin; Owner: Taylor\n- Review" },
    [],
  )[0]!;
  expect(conflict.project.owner).toBe("Unassigned");
  expect(conflict.warnings).toContain(
    "Conflicting labels. Review the source and fill the missing fields.",
  );
});
