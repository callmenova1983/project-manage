export const projectSheetFields = ["owner", "stage", "client"] as const;
export type ProjectSheetField = (typeof projectSheetFields)[number];

// Excel quotes cells containing tabs, line breaks or quotes in clipboard TSV.
export function parseSheetClipboard(text: string): string[][] {
  if (text.length > 100000) throw new Error("粘贴内容过多，请分批粘贴。");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  text = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === "\t" || c === "\n") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      if (closed)
        throw new Error("表格格式无法识别，请重新从 Excel 复制单元格。");
      cell += c;
    }
  }
  if (quoted) throw new Error("表格中的引号没有闭合，请重新复制。");
  if (cell || row.length || !text.endsWith("\n")) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length > 100) throw new Error("一次最多粘贴 100 行，请分批操作。");
  return rows;
}

export function sheetClipboard(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) =>
          /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value,
        )
        .join("\t"),
    )
    .join("\n");
}

export function planSheetPaste(
  text: string,
  startRow: number,
  startColumn: number,
  rowCount: number,
  stages: { id: string; zh: string; en: string }[],
) {
  const cells = parseSheetClipboard(text);
  if (startRow + cells.length > rowCount)
    throw new Error("粘贴行数超出当前表格，请检查起始单元格或清除搜索条件。");
  const allStages = [
    { id: "unclassified", zh: "阶段待补", en: "Stage to complete" },
    ...stages,
  ];
  return cells.flatMap((row, r) => {
    if (startColumn + row.length > projectSheetFields.length)
      throw new Error("列数超出范围，请按“负责人、阶段、客户”的顺序复制。");
    return row.map((raw, c) => {
      const field = projectSheetFields[startColumn + c]!;
      let value = raw.trim();
      if (field === "stage") {
        const match = allStages.find((s) =>
          [s.id, s.zh, s.en].some(
            (label) => label.toLowerCase() === value.toLowerCase(),
          ),
        );
        if (!match && value)
          throw new Error(
            `第 ${r + 1} 行阶段“${value}”无法识别，请使用表格中的阶段名称。`,
          );
        value = match?.id ?? "unclassified";
      }
      if (value.length > (field === "client" ? 120 : 80))
        throw new Error(`第 ${r + 1} 行内容过长，请缩短后重试。`);
      return { row: startRow + r, column: startColumn + c, field, value };
    });
  });
}
