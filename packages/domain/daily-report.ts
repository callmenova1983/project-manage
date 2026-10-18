import type { Status } from "./types.js";

/** A reported fact or an explicit next step, never a command to close a task. */
export interface DailyReportEntry {
  sourceLine: number;
  sourceText: string;
  title: string;
  action: "task" | "update";
  status: Status;
  reporter?: string;
  reportTo?: string;
  workDate?: string;
  invalidWorkDate?: true;
  assignee?: string;
  contextText?: string;
}

const currentHeading =
  /^(?:(?:今日|今天|当日|每日|本日)(?:工作)?(?:总结|汇报|记录|内容|完成情况)?|工作日报|日报|daily\s+(?:work\s+)?report|today['’]?s\s+work)(?:\s*[:：])?$/i;
const futureHeading =
  /^(?:(?:明日|明天|下周|后续|下一步)(?:工作)?(?:计划|安排|事项|待办)?|待办事项|工作计划)(?:\s*[:：])?$/;
const recipientLabel =
  /^(?:report\s*to|汇报对象|汇报给|收件人)\s*[:：]\s*(.+)$/i;
const reporterLabel =
  /^(?:汇报人|报告人|填报人|记录人|姓名|reporter|report\s*from)\s*[:：]\s*(.+)$/i;
const numbered = /^\s*(?:\d+\s*[.、)）]|[（(]\d+[)）])\s*/;
const filename =
  /^【[^\n]+\.(?:txt|csv|tsv|md|log|json|xlsx?|docx?|pptx?|pdf|png|jpe?g|webp|gif)】$/i;

function plain(line: string) {
  return line
    .trim()
    .replace(/^[#*\s]+|[*\s]+$/g, "")
    .trim();
}

function person(value: string): string | undefined {
  const name = value.trim().replace(/[:：]$/, "");
  return name.length <= 80 &&
    /^(?:[\p{Script=Han}·]{2,8}|[A-Za-z][A-Za-z .'-]{1,60})$/u.test(name) &&
    !/项目|学校|公司|中心|系统|计划|总结|工作|平台|日期/.test(name)
    ? name
    : undefined;
}

function explicitDate(value: string): string | undefined {
  const date = value.match(/(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?!\d)/)?.[1];
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
    ? undefined
    : date;
}

function heading(value: string): "current" | "future" | undefined {
  const withoutDate = value
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/^[\s:：()（）-]+|[\s()（）-]+$/g, "");
  if (currentHeading.test(withoutDate)) return "current";
  if (futureHeading.test(withoutDate)) return "future";
  return undefined;
}

function namedHeading(value: string) {
  const match = value.match(/^(.+?)(?:的|\s+)(今日工作总结|工作日报|日报)$/);
  const name = match && person(match[1]!);
  return name ? { reporter: name } : undefined;
}

export function explicitAssignee(value: string): string | undefined {
  const labeled = value.match(
    /(?:负责人|执行人|跟进人|责任人|assignee|owner)\s*[:：=]\s*([^，,；;。()（）]+?)(?=\s+(?:负责|跟进|处理|执行|完成)|[，,；;。()（）]|$)/i,
  );
  if (labeled) return person(labeled[1]!);
  const assigned = value.match(
    /(?:由|交给|安排)\s*([\p{Script=Han}·]{2,8}|[A-Za-z][A-Za-z .'-]{1,60}?)\s*(?:负责|跟进|处理|执行)/u,
  );
  if (assigned) return person(assigned[1]!);
  const responsible = value.match(
    /(?:^|[，,；;\s])([\p{Script=Han}·]{2,4})负责/u,
  );
  return responsible ? person(responsible[1]!) : undefined;
}

function ownershipOnly(value: string, owner: string | undefined) {
  if (!owner) return false;
  const withoutOwner = value.replace(owner, "").replace(/\s/g, "");
  return /^(?:(?:由|交给|安排)?(?:负责|跟进|执行)|(?:负责人|执行人|跟进人|责任人|assignee|owner)[:：=])$/i.test(
    withoutOwner,
  );
}

function isNextStep(text: string, futureSection: boolean) {
  // A cancelled or negated plan is still a reported fact, not an executable task.
  if (/不再|无需|不需要|不用|取消|不安排|不计划|暂不|暂缓/.test(text))
    return false;
  if (futureSection) return true;
  return (
    /明天|明日|后天|下周|下星期|下个月|下月|后续|下一步|接下来|择日/.test(
      text,
    ) ||
    /^(?:计划|准备|待办[:：]?|尚需|还需|需继续)/.test(text) ||
    /(?:预计|预约|计划于|安排在|定于).+(?:更换|培训|处理|排查|完成|进行|开展|上线|交付)/.test(
      text,
    )
  );
}

function updateStatus(text: string): Status {
  if (
    /受阻|阻塞|卡住|等待|等候|待(?:客户|供应商|审批|确认|回复)|无法|未能/.test(
      text,
    )
  )
    return "blocked";
  if (
    /未(?:完成|解决|处理|修复|上线|交付)|尚未|没(?:有)?(?:完成|解决|处理|修复)|正在|进行中|仍在|继续|剩余|部分完成|未结束|待定|不再|取消|暂不|暂缓|不需要|无需/.test(
      text,
    )
  )
    return "in_progress";
  return "done";
}

function statements(text: string, futureSection: boolean) {
  return text.split(/[。！？!?；;]+/).flatMap((sentence) => {
    const clean = sentence.trim();
    if (!clean) return [];
    const clauses = clean
      .split(/[，,（）()]+/)
      .map((clause) => clause.trim())
      .filter(Boolean);
    const parts: {
      title: string;
      action: "task" | "update";
      assignee?: string;
    }[] = [];
    let prefixOwner: string | undefined;
    for (const clause of clauses) {
      const action = isNextStep(clause, futureSection) ? "task" : "update";
      const last = parts.at(-1);
      const owner = explicitAssignee(clause);
      if (ownershipOnly(clause, owner)) {
        if (last) {
          last.title += `，${clause}`;
          last.assignee = owner;
        } else prefixOwner = owner;
        continue;
      }
      const ownerChanged =
        owner &&
        owner !== (last?.assignee || explicitAssignee(last?.title ?? ""));
      if (last?.action === action && !ownerChanged) last.title += `，${clause}`;
      else
        parts.push({ title: clause, action, assignee: owner || prefixOwner });
      prefixOwner = undefined;
    }
    // Keep the original punctuation when there is no temporal split.
    if (parts.length === 1) parts[0]!.title = clean;
    return parts;
  });
}

/**
 * Recognizes report framing before extracting work. Relative dates and tentative
 * arrangements stay verbatim: this parser never invents a deadline or task ID.
 */
export function parseDailyReport(source: string): DailyReportEntry[] | null {
  const rawLines = source.split(/\r?\n/);
  const lines = rawLines.map(plain);
  if (
    !lines.some((line) => heading(line) === "current" || namedHeading(line)) &&
    !(
      lines.some((line) => recipientLabel.test(line)) &&
      lines.some((line) => numbered.test(line))
    )
  )
    return null;

  const result: DailyReportEntry[] = [];
  let reporter: string | undefined;
  let reportTo: string | undefined;
  let workDate: string | undefined;
  let sharedDate: string | undefined;
  let invalidWorkDate: true | undefined;
  let sharedInvalidWorkDate: true | undefined;
  let futureSection = false;
  let futureHeadingText = "";
  let started = false;
  let projectContext = "";
  let sharedProjectContext = "";
  let itemContext = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line || /^[-_=]{3,}$/.test(line)) continue;
    if (filename.test(line)) {
      reporter = reportTo = undefined;
      workDate = sharedDate;
      invalidWorkDate = sharedInvalidWorkDate;
      projectContext = sharedProjectContext;
      itemContext = "";
      started = futureSection = false;
      futureHeadingText = "";
      continue;
    }
    const recipient = line.match(recipientLabel);
    if (recipient) {
      const name = recipient[1]!.trim();
      reportTo = name.length <= 80 ? name : undefined;
      continue;
    }
    if (/^项目\s*[:：]\s*\S/.test(line)) {
      projectContext = line;
      if (!started && !result.length) sharedProjectContext = line;
      itemContext = "";
      continue;
    }
    const reporterMatch = line.match(reporterLabel);
    const labeledReporter = reporterMatch
      ? person(reporterMatch[1]!)
      : undefined;
    if (reporterMatch && !labeledReporter) {
      reporter = reportTo = undefined;
      workDate = sharedDate;
      invalidWorkDate = sharedInvalidWorkDate;
      projectContext = sharedProjectContext;
      itemContext = futureHeadingText = "";
      started = futureSection = false;
      continue;
    }
    const nextLines = lines
      .slice(index + 1)
      .filter(Boolean)
      .slice(0, 2);
    const bareReporter =
      person(line) &&
      nextLines.some(
        (next) => recipientLabel.test(next) || heading(next) === "current",
      )
        ? person(line)
        : undefined;
    const named = namedHeading(line);
    const nextReporter =
      labeledReporter?.trim() || bareReporter || named?.reporter;
    if (nextReporter) {
      reporter = nextReporter;
      reportTo = undefined;
      workDate = sharedDate;
      invalidWorkDate = sharedInvalidWorkDate;
      projectContext = sharedProjectContext;
      itemContext = "";
      started = !!named;
      futureSection = false;
      futureHeadingText = "";
      continue;
    }
    const section = heading(line);
    const date = explicitDate(line);
    const hasDate = /(?:^|[^\d])\d{4}-\d{2}-\d{2}(?!\d)/.test(line);
    if (section) {
      started = true;
      futureSection = section === "future";
      futureHeadingText = futureSection ? rawLines[index]! : "";
      if (hasDate) {
        workDate = date;
        invalidWorkDate = date ? undefined : true;
        if (!reporter && !result.length) {
          sharedDate = date;
          sharedInvalidWorkDate = invalidWorkDate;
        }
      }
      itemContext = "";
      continue;
    }
    if (/^(?:日期\s*[:：]\s*)?\d{4}-\d{2}-\d{2}$/.test(line)) {
      workDate = date;
      invalidWorkDate = date ? undefined : true;
      if (!reporter && !result.length) {
        sharedDate = date;
        sharedInvalidWorkDate = invalidWorkDate;
      }
      continue;
    }
    const isNumbered = numbered.test(line);
    if (!started && !isNumbered) continue;
    started = true;
    if (!isNumbered && /^[^，,。；;]{1,100}[:：]$/.test(line)) {
      projectContext = line;
      itemContext = "";
      continue;
    }
    const text = line
      .replace(numbered, "")
      .replace(/^[-•]\s*/, "")
      .trim();
    if (!text) continue;
    const sourceText = rawLines[index]!;
    if (isNumbered) itemContext = sourceText;
    const contextText = [
      sourceText,
      itemContext,
      projectContext,
      futureHeadingText,
    ]
      .filter((value, i, values) => value && values.indexOf(value) === i)
      .join("\n");
    let assignee = reporter;
    for (const part of statements(text, futureSection)) {
      // Later ownership must not rewrite who performed earlier work. Explicit
      // ownership can carry forward to subsequent clauses on the same line.
      assignee = part.assignee || explicitAssignee(part.title) || assignee;
      const period = futureHeadingText.match(/明日|明天|下周|后续|下一步/)?.[0];
      const title =
        part.action === "task" && period && !part.title.includes(period)
          ? `${period}：${part.title}`
          : part.title;
      result.push({
        sourceLine: index + 1,
        sourceText,
        title: title.slice(0, 240),
        action: part.action,
        status: part.action === "task" ? "todo" : updateStatus(part.title),
        reporter,
        reportTo,
        workDate,
        invalidWorkDate,
        assignee,
        contextText,
      });
    }
  }
  return result;
}
