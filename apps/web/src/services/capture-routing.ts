import {
  detectColumns,
  parseDelimited,
} from "../../../../packages/domain/intake";

import { normalizeCreationText } from "../../../../packages/domain/intake-text";
export { normalizeCreationText };
/** Page context supplies an omitted destination, never replaces a named one. */
export function captureNeedsProjectContext(text: string) {
  const source = normalizeCreationText(text);
  if (/新建|创建|新增项目/.test(text)) return false;
  if (
    /(?:^|[\n;；])\s*(?:项目(?:名称)?|project(?: name)?)\s*[:：]/i.test(source)
  )
    return false;
  if (/(?:^|\n)\s*[^\n:：]{1,100}(?:项目|工程|园区|码头)\s*[:：]/.test(source))
    return false;
  return true;
}
export function structuredCapture(text: string) {
  // Different worksheets can use different layouts; do not apply the first
  // sheet's column mapping to the rest of the workbook.
  if ((text.match(/^【[^\n]*】\s*$/gm)?.length ?? 0) > 2 && text.includes("\t"))
    return false;
  const normalized = normalizeCreationText(text);
  const first =
    text
      .split(/\r?\n/)
      .find((line) => line.trim() && !/^【.*】$/.test(line.trim())) ?? "";
  if (/[\t,]/.test(first)) {
    try {
      const fields = detectColumns(parseDelimited(first)[0] ?? []);
      if (
        fields.includes("project") &&
        fields.filter((field) => field !== "ignore").length >= 2
      )
        return true;
    } catch {
      /* The editor will retain malformed text for correction. */
    }
  }
  const lines = normalized
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^【.*】$/.test(line.trim()));
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        (/(?:^|\n|[;；])\s*(?:新建项目|创建项目|项目(?:名称)?|project(?: name)?)\s*[:：]/i.test(
          line,
        ) &&
          /(?:[;；，,]\s*)(?:客户(?:名称)?|负责人|项目负责人|阶段|任务|client|owner|stage|task)\s*[:：]/i.test(
            line,
          )) ||
        (normalized !== text && /^项目\s*[:：]/.test(line)),
    )
  );
}
