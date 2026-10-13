import readExcelFile from "read-excel-file/web-worker";
import type { IntakeSource } from "../../../../packages/domain/intake";
function checkArchive(data: ArrayBuffer) {
  const v = new DataView(data);
  let end = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("This is not a supported XLSX workbook");
  const count = v.getUint16(end + 10, true);
  let offset = v.getUint32(end + 16, true),
    total = 0;
  if (count > 500 || count === 65535)
    throw new Error("Workbook is too large. Export the needed rows as CSV.");
  for (let n = 0; n < count; n++) {
    if (offset + 46 > v.byteLength || v.getUint32(offset, true) !== 0x02014b50)
      throw new Error("Invalid workbook archive");
    if (v.getUint16(offset + 8, true) & 1)
      throw new Error("Password-protected workbooks are not supported");
    total += v.getUint32(offset + 24, true);
    if (total > 20 * 1024 * 1024)
      throw new Error("Workbook is too large. Export the needed rows as CSV.");
    offset +=
      46 +
      v.getUint16(offset + 28, true) +
      v.getUint16(offset + 30, true) +
      v.getUint16(offset + 32, true);
  }
}
self.onmessage = async (
  event: MessageEvent<{ data: ArrayBuffer; name: string }>,
) => {
  try {
    checkArchive(event.data.data);
    const sheets = await readExcelFile(event.data.data, { trim: false });
    if (sheets.length > 20)
      throw new Error("Use a workbook with at most 20 sheets");
    const sources: IntakeSource[] = sheets.map((sheet) => {
      if (sheet.data.length > 201 || sheet.data.some((row) => row.length > 30))
        throw new Error("Use at most 200 data rows and 30 columns per sheet");
      const rows = sheet.data.map((row) =>
        row.map((cell) =>
          cell instanceof Date
            ? cell.toISOString().slice(0, 10)
            : cell == null
              ? ""
              : String(cell),
        ),
      );
      if (JSON.stringify(rows).length > 200000)
        throw new Error("Source is too large. Use at most 200 rows.");
      return {
        kind: "xlsx",
        name: event.data.name,
        sheet: sheet.sheet,
        text: "",
        rows,
      };
    });
    self.postMessage({ sources });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Could not read the workbook",
    });
  }
};
