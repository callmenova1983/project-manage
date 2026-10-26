import {
  parseDelimited,
  type IntakeSource,
} from "../../../../packages/domain/intake";
export async function readIntakeFile(
  file: File,
  signal: AbortSignal,
): Promise<IntakeSource[]> {
  if (file.size > 2 * 1024 * 1024)
    throw new Error("Use a file smaller than 2 MB");
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  if (!["txt", "csv", "tsv", "xlsx"].includes(ext ?? ""))
    throw new Error("Choose a TXT, CSV, TSV or XLSX file");
  if (ext !== "xlsx") {
    const text = await file.text();
    signal.throwIfAborted();
    return [
      {
        kind: ext === "txt" ? "text" : "csv",
        name: file.name,
        sheet: "",
        text,
        ...(ext === "txt"
          ? {}
          : {
              rows: parseDelimited(
                text.replace(/^\uFEFF/, ""),
                ext === "tsv" ? "\t" : ",",
              ),
            }),
      },
    ];
  }
  const data = await file.arrayBuffer();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/intake.worker.ts", import.meta.url),
      { type: "module" },
    );
    const clean = () => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(new DOMException("Reading cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      clean();
      reject(new Error("Reading timed out. Export the needed rows as CSV."));
    }, 15000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      clean();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.sources);
    };
    worker.onerror = () => {
      clean();
      reject(new Error("Could not read the workbook"));
    };
    worker.postMessage({ data, name: file.name }, [data]);
  });
}
