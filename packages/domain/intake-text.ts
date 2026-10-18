import { DomainError, type Project } from "./types.js";
import type { IntakeField } from "./intake.js";
export function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}
export const fieldAliases: Record<Exclude<IntakeField, "ignore">, string[]> = {
  project: [
    "project",
    "project name",
    "name",
    "项目",
    "项目名称",
    "新建项目",
    "创建项目",
  ],
  channel: ["channel", "渠道", "项目渠道", "渠道方"],
  shortName: ["short name", "shortname", "简称", "项目简称"],
  aliases: ["aliases", "alias", "别名", "项目别名"],
  client: ["client", "customer", "客户", "客户名称"],
  owner: ["owner", "project owner", "负责人", "项目负责人"],
  stage: ["stage", "phase", "阶段", "项目阶段"],
  task: ["task", "todo", "task title", "任务", "待办", "事项"],
  assignee: ["assignee", "task owner", "执行人", "任务负责人"],
  dueDate: ["due", "due date", "deadline", "截止", "截止日期", "日期"],
  status: ["status", "task status", "状态", "任务状态"],
  description: ["description", "notes", "描述", "备注"],
};
export type TextFields = Partial<Record<IntakeField, string>>;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const labelKeys = Object.values(fieldAliases)
  .flat()
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join("|");
export function normalizeCreationText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(
          /^(?:[-*•]\s*|\d+[.)、]\s*)(?=(?:请|帮我)?(?:新建|创建|新增|建立))/,
          "",
        )
        .replace(
          /^(?:请|帮我)?(?:新建|创建|新增|建立)(?:一个|个)?项目\s*[:：\s]+/,
          "项目：",
        )
        .replace(
          /^(?:请|帮我)?(?:新建|创建|新增|建立)(.{1,100}?项目)(?=[，,;；。.!！\s]|$)/,
          "项目：$1",
        ),
    )
    .join("\n");
}
export function captureTextFields(
  line: string,
  warnings: string[] = [],
): TextFields {
  return labeled(normalizeCreationText(line), warnings);
}
function labeled(line: string, warnings: string[] = []): TextFields {
  const fields: TextFields = {},
    conflicts = new Set<IntakeField>();
  let firstLabel = -1;
  const labels = [
    ...line.matchAll(
      new RegExp(
        `(?:^|[;；，,]\\s*|\\s+)(${labelKeys})\\s*(?:[:：]|是|为)\\s*`,
        "gi",
      ),
    ),
  ];
  for (const [index, m] of labels.entries()) {
    if (firstLabel === -1) firstLabel = m.index!;
    const key = Object.entries(fieldAliases).find(([, names]) =>
      names.includes(normalizeName(m[1]!)),
    )![0] as IntakeField;
    const value = line
      .slice(m.index! + m[0].length, labels[index + 1]?.index ?? line.length)
      .trim();
    if (conflicts.has(key)) continue;
    if (fields[key] && normalizeName(fields[key]!) !== normalizeName(value)) {
      fields[key] = "";
      conflicts.add(key);
      warnings.push(
        "Conflicting labels. Review the source and fill the missing fields.",
      );
    } else fields[key] = value;
  }
  if (firstLabel > 0 && !fields.task)
    fields.task = line.slice(0, firstLabel).trim();
  return fields;
}
/** ASCII aliases must be whole tokens; very short aliases are explicit-label only. */
export function mentionsProject(text: string, project: Project) {
  const normalized = normalizeName(text).replace(
    /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,
    " ",
  );
  return [project.name, ...project.aliases].find((name) => {
    const term = normalizeName(name);
    if ([...term].length < 2) return false;
    if (/^[\u0020-\u007E]+$/.test(term))
      return new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escape(term)}(?=$|[^\\p{L}\\p{N}_])`,
        "u",
      ).test(normalized);
    return normalized.includes(term);
  });
}
export interface TextFragment {
  index: number;
  part: number;
  fields: TextFields;
  contextRows: number[];
  warnings: string[];
  text: string;
}
export function textFragments(
  text: string,
  projects: Project[],
): TextFragment[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1000)
    throw new DomainError("Source is too large. Use at most 200 rows.");
  const fragments: TextFragment[] = [];
  let context:
    | {
        fields: TextFields;
        rows: number[];
        warnings: string[];
        used: boolean;
        conflicts: Set<IntakeField>;
      }
    | undefined;
  function flush() {
    if (context && !context.used)
      fragments.push({
        index: context.rows[0]! - 1,
        part: 0,
        fields: { ...context.fields },
        contextRows: context.rows.slice(1),
        warnings: [...context.warnings],
        text: lines[context.rows[0]! - 1]!,
      });
    context = undefined;
  }
  for (const [index, raw] of lines.entries()) {
    const line = normalizeCreationText(
      raw.trim().replace(/^(?:[-*•]\s+|\d+[.)、]\s*)/, ""),
    );
    if (!line) continue;
    const headingWarnings: string[] = [];
    let heading = labeled(line, headingWarnings);
    const marked = /^(?:#{1,6}\s+(.+)|\[([^\]]+)\]|【([^】]+)】)[:：]?$/.exec(
      line,
    );
    if (marked)
      heading = {
        project: (marked[1] ?? marked[2] ?? marked[3])!
          .replace(/[:：]$/, "")
          .trim(),
      };
    else if (!Object.keys(heading).length && /[:：]$/.test(line))
      heading = { project: line.slice(0, -1).trim() };
    if (
      heading.project &&
      !("task" in heading) &&
      !("assignee" in heading) &&
      !("dueDate" in heading) &&
      !("status" in heading)
    ) {
      flush();
      context = {
        fields: heading,
        rows: [index + 1],
        warnings: headingWarnings,
        used: false,
        conflicts: new Set(),
      };
      continue;
    }
    const metadata = Object.keys(heading) as IntakeField[];
    if (
      context &&
      !context.used &&
      metadata.length &&
      metadata.every((key) =>
        [
          "client",
          "owner",
          "stage",
          "description",
          "channel",
          "shortName",
          "aliases",
        ].includes(key),
      )
    ) {
      context.warnings.push(...headingWarnings);
      for (const key of metadata) {
        if (context.conflicts.has(key)) continue;
        if (
          context.fields[key] &&
          normalizeName(context.fields[key]!) !== normalizeName(heading[key]!)
        ) {
          context.fields[key] = "";
          context.conflicts.add(key);
          context.warnings.push(
            "Conflicting section details. Review the original lines and fill the missing fields.",
          );
        } else context.fields[key] = heading[key];
      }
      context.rows.push(index + 1);
      if (context.rows.length > 20)
        throw new DomainError(
          "Too many context lines. Split the section before reviewing.",
        );
      continue;
    }
    const pieces = line
      .split(/[;；]\s*(?=(?:project|项目|项目名称)\s*[:：])/i)
      .flatMap((block) => {
        const tasks = block.split(
          /[;；]\s*(?=(?:task|任务|待办|事项)\s*[:：])/i,
        );
        if (tasks.length > 1) {
          const first = tasks.shift()!;
          return /^(?:task|任务|待办|事项)\s*[:：]/i.test(first.trim())
            ? [first, ...tasks]
            : tasks.map((task) => `${first}; ${task}`);
        }
        if (!/(?:^|[;；])\s*[^;；:：]+[:：]/.test(block))
          return block.split(/[;；]/);
        return [block];
      })
      .filter((piece) => piece.trim());
    for (const [part, piece] of pieces.entries()) {
      const pieceWarnings: string[] = [];
      let fields = labeled(piece, pieceWarnings);
      if (!fields.project) {
        const prefix = /^([^:：]+)[:：]\s*(.+)$/.exec(piece);
        if (
          prefix &&
          projects.some((p) =>
            [p.name, ...p.aliases].some(
              (n) => normalizeName(n) === normalizeName(prefix[1]!),
            ),
          )
        ) {
          fields = {
            ...labeled(prefix[2]!, pieceWarnings),
            project: prefix[1]!.trim(),
          };
          if (!fields.task) fields.task = prefix[2]!.trim();
        }
      }
      if (!Object.keys(fields).length) fields.task = piece.trim();
      const inherited = !fields.project && !!context;
      if (inherited) {
        fields = { ...context!.fields, ...fields };
        context!.used = true;
      }
      if (!fields.task && inherited) fields.task = piece.trim();
      fragments.push({
        index,
        part,
        fields,
        contextRows: inherited ? [...context!.rows] : [],
        warnings: [
          ...new Set([
            ...pieceWarnings,
            ...(inherited ? context!.warnings : []),
          ]),
        ],
        text: piece,
      });
      if (fragments.length > 200)
        throw new DomainError("Source is too large. Use at most 200 rows.");
    }
  }
  flush();
  return fragments;
}
