import { validateTaskDependencies } from "./task-dependencies.js";
import { fieldAliases as aliases, normalizeName } from "./intake-text.js";
export { normalizeName } from "./intake-text.js";
import { defaultCatalogs, type Catalogs } from "./admin.js";
import { captureSourceSchema } from "./capture.js";
import { channelEntries } from "./channels.js";
import { z } from "zod";
import {
  dateSchema,
  DomainError,
  projectInput,
  projectSchema,
  taskInput,
  taskSchema,
  type Project,
  type Task,
  type Snapshot,
  type ProjectInput,
  type TaskInput,
  type Stage,
  type Status,
} from "./types.js";

export const intakeSourceSchema = z
  .object({
    kind: z.enum(["text", "csv", "xlsx"]),
    name: z.string().max(180),
    sheet: z.string().max(120).default(""),
    text: z.string().max(200000),
    originalSource: captureSourceSchema.optional(),
    rows: z
      .array(z.array(z.string().max(20000)).max(30))
      .max(201)
      .optional(),
  })
  .strict();
export type IntakeSource = z.infer<typeof intakeSourceSchema>;
export const intakeFields = [
  "ignore",
  "project",
  "channel",
  "shortName",
  "aliases",
  "client",
  "address",
  "owner",
  "stage",
  "task",
  "assignee",
  "dueDate",
  "status",
  "description",
] as const;
export type IntakeField = (typeof intakeFields)[number];
export interface IntakeCandidate {
  id: string;
  sourceRow: number;
  sourcePart?: number;
  contextRows?: number[];
  matchEvidence?: {
    projectId: string;
    kind: "name" | "alias" | "partial" | "mention";
    value: string;
  }[];
  sourceText: string;
  requestedChannel?: string;
  selected: boolean;
  project: ProjectInput;
  task: Omit<TaskInput, "projectId"> | null;
  matches: string[];
  targetProjectId: string;
  targetProjectVersion: number | null;
  duplicateConfirmed: boolean;
  matchConfirmed: boolean;
  warnings: string[];
}
const rowSchema = z
  .object({
    sourceRow: z.number().int().min(1).max(1000),
    sourcePart: z.number().int().min(0).max(199).optional(),
    contextRows: z.array(z.number().int().min(1).max(1000)).max(20).optional(),
    targetProjectId: z.string().max(100),
    targetProjectVersion: z.number().int().positive().nullable(),
    project: projectInput,
    task: taskInput.omit({ projectId: true }).nullable(),
    duplicateConfirmed: z.boolean(),
    matchConfirmed: z.boolean().optional(),
  })
  .strict();
export const intakeInput = z
  .object({
    source: intakeSourceSchema,
    rows: z.array(rowSchema).min(1).max(200),
    confirmed: z.literal(true),
  })
  .strict();
export type IntakeInput = z.infer<typeof intakeInput>;
export interface IntakeBatch {
  id: string;
  createdAt: string;
  actor: string;
  source: IntakeSource;
  projects: Project[];
  tasks: Task[];
  state: "applied" | "undone";
  undoneAt?: string;
  entries: {
    sourceRow: number;
    sourcePart?: number;
    contextRows?: number[];
    projectId: string;
    taskId: string | null;
  }[];
}
export function detectColumns(row: string[]): IntakeField[] {
  return row.map(
    (cell) =>
      (Object.entries(aliases).find(([, names]) =>
        names.includes(normalizeName(cell)),
      )?.[0] ?? "ignore") as IntakeField,
  );
}
export function parseDelimited(
  text: string,
  delimiter = text.includes("\t") ? "\t" : ",",
): string[][] {
  if (text.length > 200000)
    throw new DomainError("Source is too large. Use at most 200 rows.");
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else value += c;
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (c === delimiter) {
      row.push(value);
      value = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      closed = false;
    } else {
      if (closed && !/\s/.test(c))
        throw new DomainError("Invalid quoted table value");
      if (!closed) value += c;
    }
    if (rows.length > 201 || row.length > 30)
      throw new DomainError("Source is too large. Use at most 200 rows.");
  }
  if (quoted) throw new DomainError("Unclosed quote in table");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
const stageMap: Record<string, Stage> = {
  potential: "potential",
  "potential demand": "potential",
  潜在需求: "potential",
  proposal: "proposal",
  "proposal & quote": "proposal",
  前期沟通方案报价: "proposal",
  方案报价: "proposal",
  approved: "approved",
  "ready to start": "approved",
  已立项待实施: "approved",
  implementation: "implementation",
  "in progress": "implementation",
  实施中: "implementation",
  operations: "operations",
  验收后运营: "operations",
  运营: "operations",
};
const statusMap: Record<string, Status> = {
  todo: "todo",
  "to do": "todo",
  待做: "todo",
  待办: "todo",
  in_progress: "in_progress",
  "in progress": "in_progress",
  进行中: "in_progress",
  done: "done",
  completed: "done",
  完成: "done",
  已完成: "done",
  blocked: "blocked",
  "needs coordination": "blocked",
  待协调: "blocked",
};
export function sourceRows(source: IntakeSource) {
  return source.rows ?? source.text.split(/\r?\n/).map((line) => [line]);
}
export function sourceAt(source: IntakeSource, row: number) {
  const cells = sourceRows(source)[row - 1];
  if (!cells) throw new DomainError("Source row is missing");
  return source.rows ? JSON.stringify(cells) : cells[0]!;
}
export function intakeCandidates(
  source: IntakeSource,
  projects: Project[],
  mapping?: IntakeField[],
  header = true,
  catalog: Catalogs = defaultCatalogs,
): IntakeCandidate[] {
  intakeSourceSchema.parse(source);
  if (!source.rows)
    throw new DomainError(
      "自由文本请通过 AI 助手识别；手工导入仅接受已映射的表格。",
    );
  const rows = sourceRows(source);
  const columns =
    mapping ?? (source.rows ? detectColumns(rows[0] ?? []) : undefined);
  const first = source.rows && header ? 1 : 0;
  const result: IntakeCandidate[] = [];
  const fragments = rows.flatMap((cells, index) =>
    index < first || !cells.some((c) => c.trim())
      ? []
      : [{ cells, index, part: 0 }],
  );
  for (const { cells, index, part } of fragments) {
    const fields: Partial<Record<IntakeField, string>> = {};
    columns?.forEach((key, i) => {
      if (key !== "ignore") fields[key] = cells[i]?.trim() ?? "";
    });
    const name = fields.project ?? "",
      client = fields.client ?? "";
    const matches = projects.filter(
      (p) =>
        [p.name, p.shortName ?? "", ...p.aliases]
          .filter(Boolean)
          .some((n) => normalizeName(n) === normalizeName(name)) &&
        (!client || normalizeName(p.client) === normalizeName(client)),
    );
    const exactMatch = matches.length === 1;
    const partialMatches =
      name && !matches.length
        ? projects.filter((p) =>
            [p.name, p.shortName ?? "", ...p.aliases]
              .filter(Boolean)
              .some((n) => normalizeName(n).includes(normalizeName(name))),
          )
        : [];
    const hints = matches.length ? matches : partialMatches;
    const evidence = hints.map((project) => ({
      projectId: project.id,
      kind: (matches.includes(project) ? "name" : "partial") as
        "name" | "partial",
      value: name,
    }));
    const needsInbox =
      !name || hints.length > 1 || (!exactMatch && hints.length > 0);
    const inbox = projects.find((p) => p.intakeInbox === true);
    const target =
      exactMatch && hints.length === 1
        ? matches[0]
        : needsInbox
          ? inbox
          : undefined;
    if (needsInbox && !fields.task)
      fields.task = cells[0]!.trim().slice(0, 240);
    const stage =
        stageMap[normalizeName(fields.stage ?? "")] ??
        catalog.stages.find((s) =>
          [s.id, s.en, s.zh].some(
            (n) => normalizeName(n) === normalizeName(fields.stage ?? ""),
          ),
        )?.id,
      status = statusMap[normalizeName(fields.status ?? "")];
    const date = fields.dueDate?.trim() ?? "";
    const warnings: string[] = [];
    if (fields.task && fields.task.length > 240)
      warnings.push(
        "Task title was shortened. The full original text is retained in the source.",
      );
    if (fields.stage && !stage)
      warnings.push("Unrecognized stage. Choose a stage.");
    if (
      fields.channel &&
      !channelEntries(catalog).some(
        (channel) =>
          !channel.archived &&
          [channel.id, channel.name, channel.shortName].some(
            (name) => normalizeName(name) === normalizeName(fields.channel!),
          ),
      )
    )
      warnings.push(
        `未找到渠道“${fields.channel}”，请明确选择渠道；不会自动改为公司。`,
      );
    if (fields.status && !status)
      warnings.push("Unrecognized task status. Choose a status.");
    if (date && !dateSchema.safeParse(date).success)
      warnings.push("Date needs review. Use YYYY-MM-DD.");
    if (hints.length > 1)
      warnings.push("Several projects match. Choose the target.");
    else if (!exactMatch && partialMatches.length)
      warnings.push(
        "Partial project match. Confirm the target or keep it in Intake inbox.",
      );
    if (needsInbox)
      warnings.push(
        "Unresolved project. Save in Intake inbox and assign it later.",
      );
    result.push({
      id: `row-${index + 1}-${part}`,
      sourceRow: index + 1,
      sourcePart: part,
      contextRows: [],
      matchEvidence: evidence,
      sourceText: sourceAt(source, index + 1),
      requestedChannel: fields.channel,
      selected: true,
      project: {
        name: target?.name ?? (needsInbox ? "Intake inbox" : name),
        channelId:
          target?.channelId ??
          (fields.channel
            ? (channelEntries(catalog).find(
                (channel) =>
                  !channel.archived &&
                  [channel.id, channel.name, channel.shortName].some(
                    (name) =>
                      normalizeName(name) === normalizeName(fields.channel!),
                  ),
              )?.id ?? "")
            : "company"),
        shortName: target?.shortName ?? fields.shortName ?? "",
        client: target?.client ?? (needsInbox ? "" : client),
        owner:
          target?.owner ??
          (needsInbox ? "Unassigned" : fields.owner || "Unassigned"),
        stage:
          target?.stage ??
          (needsInbox
            ? "unclassified"
            : (stage ?? (fields.stage ? "" : "unclassified"))),
        discipline: target?.discipline ?? "Unassigned",
        description: needsInbox
          ? ""
          : [
              fields.description,
              fields.address ? `地址：${fields.address}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
        ...(target?.location ? { location: target.location } : {}),
        latestUpdate: "",
        notes: "",
        aliases:
          target?.aliases ??
          fields.aliases
            ?.split(/[、，,|]/)
            .map((value) => value.trim())
            .filter(Boolean) ??
          [],
        ...(needsInbox ? { intakeInbox: true } : {}),
      },
      task: fields.task
        ? {
            title: fields.task.slice(0, 240),
            description: needsInbox ? (fields.description ?? "") : "",
            parentId: null,
            status: status ?? "todo",
            assignee: fields.assignee || "Unassigned",
            dueDate: dateSchema.safeParse(date).success ? date : null,
            workDates: [],
            workWeek: null,
          }
        : null,
      matches: hints.map((p) => p.id),
      targetProjectId: target?.id ?? "",
      targetProjectVersion: target?.version ?? null,
      duplicateConfirmed: false,
      matchConfirmed: false,
      warnings,
    });
  }
  if (result.length > 200)
    throw new DomainError("Source is too large. Use at most 200 rows.");
  return result;
}

/** Only fill missing fields. Never pick a winner between conflicting facts. */
function mergeProjectDraft(
  prior: ProjectInput,
  next: ProjectInput,
): ProjectInput {
  const merged: Record<string, unknown> = { ...prior };
  const missing = (field: string, value: unknown) =>
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    ((field === "owner" || field === "discipline") && value === "Unassigned") ||
    (field === "stage" && value === "unclassified");
  for (const [field, value] of Object.entries(next)) {
    const previous = merged[field];
    if (missing(field, value)) continue;
    if (missing(field, previous)) merged[field] = value;
    else if (
      (field === "name" || field === "client") &&
      normalizeName(String(previous)) === normalizeName(String(value))
    )
      continue;
    else if (JSON.stringify(previous) !== JSON.stringify(value))
      throw new DomainError(
        `Rows for the same new project have different details (${field}). Review the conflicting rows before saving.`,
      );
  }
  return projectInput.parse(merged);
}

export function planIntake(
  input: IntakeInput,
  snapshot: Snapshot,
  actor: string,
  id: () => string,
  now = new Date().toISOString(),
): IntakeBatch {
  input = intakeInput.parse(input);
  const projects: Project[] = [],
    tasks: Task[] = [];
  const entries: IntakeBatch["entries"] = [];
  const names = new Map<string, Project>();
  const seenRows = new Set<string>();
  for (const row of input.rows) {
    sourceAt(input.source, row.sourceRow);
    for (const line of row.contextRows ?? []) sourceAt(input.source, line);
    const rowKey = `${row.sourceRow}:${row.sourcePart ?? 0}`;
    if (seenRows.has(rowKey)) throw new DomainError("Duplicate source row");
    seenRows.add(rowKey);
    let project: Project;
    if (row.targetProjectId) {
      const target = snapshot.projects.find(
        (p) => p.id === row.targetProjectId,
      );
      if (!target) throw new DomainError("Target project no longer exists");
      if (target.version !== row.targetProjectVersion)
        throw new DomainError(
          "Target project changed. Review the intake again.",
        );
      project = target;
      // Repeated project-only intake links the existing record. It must not
      // create a duplicate project or invent a task to satisfy this endpoint.
    } else {
      // A missing client must not create a second project, regardless of row order.
      // Conflicting known clients for the same name require an explicit correction.
      const key = normalizeName(row.project.name);
      const prior = names.get(key);
      if (prior) {
        Object.assign(
          prior,
          mergeProjectDraft(projectInput.strip().parse(prior), row.project),
        );
        project = prior;
      } else {
        if (
          snapshot.projects.some((p) =>
            [p.name, p.shortName ?? "", ...p.aliases]
              .filter(Boolean)
              .some(
                (n) => normalizeName(n) === normalizeName(row.project.name),
              ),
          ) &&
          !row.duplicateConfirmed
        )
          throw new DomainError(
            "Confirm creating a project with an existing name or alias",
          );
        project = {
          ...row.project,
          id: id(),
          version: 1,
          updatedAt: now,
          reportedAt: null,
          reportedBy: null,
        };
        projects.push(project);
        names.set(key, project);
      }
    }
    if (row.task) {
      if (
        [...snapshot.tasks, ...tasks].some(
          (t) =>
            t.projectId === project.id &&
            normalizeName(t.title) === normalizeName(row.task!.title),
        ) &&
        !row.duplicateConfirmed
      )
        throw new DomainError(
          "Duplicate task title. Confirm or exclude this row.",
        );
      tasks.push({
        ...row.task,
        projectId: project.id,
        id: id(),
        version: 1,
        updatedAt: now,
      });
    }
    entries.push({
      sourceRow: row.sourceRow,
      sourcePart: row.sourcePart,
      contextRows: row.contextRows,
      projectId: project.id,
      taskId: row.task ? tasks.at(-1)!.id : null,
    });
  }
  return {
    id: id(),
    createdAt: now,
    actor,
    source: input.source,
    projects,
    tasks,
    entries,
    state: "applied",
  };
}
export function intakeProvenance(batch: IntakeBatch, entityId: string) {
  const rows = batch.entries.filter(
    (e) =>
      e.taskId === entityId ||
      (!e.taskId && e.projectId === entityId) ||
      (batch.projects.some((p) => p.id === entityId) &&
        e.projectId === entityId),
  );
  return (
    `Reviewed intake · ${batch.source.name || "Pasted text"}${batch.source.sheet ? ` · ${batch.source.sheet}` : ""}\n` +
    rows
      .map((e) =>
        [...new Set([...(e.contextRows ?? []), e.sourceRow])]
          .map((row) => `Row ${row}: ${sourceAt(batch.source, row)}`)
          .join("\n"),
      )
      .join("\n")
  );
}
export function verifyIntakeUndo(batch: IntakeBatch, snapshot: Snapshot) {
  if (batch.state === "undone")
    throw new DomainError("This intake was already undone");
  for (const p of batch.projects)
    if (
      !snapshot.projects.some((x) => x.id === p.id) ||
      JSON.stringify(
        projectSchema.parse(snapshot.projects.find((x) => x.id === p.id)),
      ) !== JSON.stringify(projectSchema.parse(p))
    )
      throw new DomainError(
        "An imported project changed. Undo would overwrite newer work.",
      );
  for (const t of batch.tasks) {
    const current = snapshot.tasks.find((task) => task.id === t.id);
    const normalized = current ? taskSchema.parse(current) : undefined;
    // Migration adds order metadata without changing the task version. Legacy
    // receipts did not capture it; a real move still increments the version.
    if (normalized && t.sortOrder === undefined) delete normalized.sortOrder;
    if (
      !normalized ||
      JSON.stringify(normalized) !== JSON.stringify(taskSchema.parse(t))
    )
      throw new DomainError(
        "An imported task changed. Undo would overwrite newer work.",
      );
  }
  const pids = new Set(batch.projects.map((p) => p.id)),
    tids = new Set(batch.tasks.map((t) => t.id));
  if (
    snapshot.tasks.some(
      (t) =>
        !tids.has(t.id) &&
        (pids.has(t.projectId) || (t.parentId && tids.has(t.parentId))),
    )
  )
    throw new DomainError("New tasks depend on this intake. Undo is blocked.");
  const remaining = snapshot.tasks.filter((task) => !tids.has(task.id));
  if (
    remaining.some((task) =>
      task.dependencies?.some((edge) => tids.has(edge.taskId)),
    )
  )
    throw new DomainError(
      "Tasks outside this intake still reference its tasks. Remove those dependencies before undo.",
    );
  validateTaskDependencies(remaining);
}
