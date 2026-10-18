import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { parsePdfMaterial } from "../../apps/api/src/pdf-material";

// Small real PDF streams exercise the parser and renderer without adding a
// second production PDF dependency just to manufacture fixtures.
function makePdf(
  pages: Array<string | null | { text: string; image: true }>,
  encrypted = false,
) {
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.alloc(0),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  const add = (value: string | Buffer) => {
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    return objects.length;
  };
  const stream = (data: Buffer, attributes = "") =>
    Buffer.concat([
      Buffer.from(`<< ${attributes} /Length ${data.length} >>\nstream\n`),
      data,
      Buffer.from("\nendstream"),
    ]);
  const refs: number[] = [];
  for (const page of pages) {
    const text = typeof page === "object" && page !== null ? page.text : page;
    let resources = "/Font << /F1 3 0 R >>";
    let content = Buffer.alloc(0);
    if (typeof page === "object") {
      // An actual raster image, rather than an empty page that also lacks text.
      const pixels = Buffer.from(
        Array.from({ length: 16 * 16 }, (_, i) => (i % 16 < 8 ? 0 : 255)),
      );
      const image = add(
        stream(
          deflateSync(pixels),
          "/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
        ),
      );
      resources += ` /XObject << /Scan ${image} 0 R >>`;
      content = Buffer.from("q 180 0 0 180 10 10 cm /Scan Do Q");
    }
    if (text !== null) {
      const escaped = text.replace(/[\\()]/g, "\\$&");
      const fontSize = Math.min(12, 240 / Math.max(1, text.length));
      content = Buffer.concat([
        content,
        Buffer.from(`\nBT /F1 ${fontSize} Tf 10 100 Td (${escaped}) Tj ET`),
      ]);
    }
    const contents = add(stream(content));
    refs.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << ${resources} >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${refs.map((id) => `${id} 0 R`).join(" ")}] /Count ${refs.length} >>`,
  );
  // A password-required Standard encryption dictionary causes the PDF reader to
  // demand a password before reading any stream. No password is supplied here.
  const encryption = encrypted
    ? add(
        `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"01".repeat(32)}> /U <${"02".repeat(32)}> /P -4 >>`,
      )
    : undefined;
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    offsets.push(length);
    chunks.push(chunk);
    length += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryption ? ` /Encrypt ${encryption} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]` : ""} >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

it("extracts actual Latin and Chinese PDF fixtures with no image fallback", async () => {
  for (const name of ["report.pdf", "report-cjk.pdf"]) {
    const result = await parsePdfMaterial(
      readFileSync(
        fileURLToPath(
          new URL(`../fixtures/file-preview/${name}`, import.meta.url),
        ),
      ),
    );
    expect(result.kind).toBe("file");
    expect(result.images).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.text).toMatch(
      name === "report.pdf" ? /Project attachment preview/ : /[\u4e00-\u9fff]/,
    );
  }
});

it("reads every text page including text after a scanned page", async () => {
  const result = await parsePdfMaterial(
    makePdf(["First page status", null, "Third page changes", "Final page"]),
  );
  expect(result.text).toContain("【第 1 页】\nFirst page status");
  expect(result.text).toContain("【第 3 页】\nThird page changes");
  expect(result.text).toContain("【第 4 页】\nFinal page");
  expect(result.images).toHaveLength(1);
  expect(result.warnings[0]).toContain("第 2 页");
  const png = Buffer.from(result.images[0]!.split(",")[1]!, "base64");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);
  expect(png.readUInt32BE(20)).toBeGreaterThan(100);
});

it("renders all six scanned pages and explicitly rejects a seventh", async () => {
  const result = await parsePdfMaterial(makePdf(Array(6).fill(null)));
  expect(result.text).toBe("");
  expect(result.images).toHaveLength(6);
  expect(result.warnings[0]).toContain("第 1、2、3、4、5、6 页");
  await expect(
    parsePdfMaterial(makePdf(Array(7).fill(null))),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining("6 页"),
  });
});

it("keeps selectable headers and renders the raster scan on the same page", async () => {
  const result = await parsePdfMaterial(
    makePdf([{ text: "Page 1 header", image: true }]),
  );
  expect(result.text).toContain("Page 1 header");
  expect(result.images).toHaveLength(1);
  expect(result.images[0]).toMatch(/^data:image\/png;base64,/);
  expect(result.warnings).toEqual([
    "PDF 第 1 页已转为图片供 AI 识别，请核对识别结果。",
  ]);
});

it("preserves all mixed-page text and warns when additional images exceed six pages", async () => {
  const result = await parsePdfMaterial(
    makePdf(
      Array.from({ length: 120 }, (_, index) => ({
        text: `Page ${index + 1} header`,
        image: true as const,
      })),
    ),
  );
  expect(result.images).toHaveLength(6);
  expect(result.text).toContain("Page 7 header");
  expect(result.text).toContain("Page 120 header");
  expect(result.warnings).toHaveLength(2);
  expect(result.warnings[1]).toContain("共 114 页的文字和原始附件已保留");
  expect(result.warnings[1]).toContain("额外图片内容尚未识别");
  expect(result.warnings.every((warning) => warning.length <= 300)).toBe(true);
});

it("rejects oversized text, oversized files, damaged PDFs and encrypted PDFs with actionable 400s", async () => {
  // Keep every string visible on its page so the library retains the full text.
  await expect(
    parsePdfMaterial(
      makePdf(Array.from({ length: 161 }, () => "A".repeat(100))),
    ),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining("16000"),
  });
  await expect(
    parsePdfMaterial(Buffer.alloc(8 * 1024 * 1024 + 1)),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining("8 MB"),
  });
  await expect(
    parsePdfMaterial(Buffer.from("%PDF-1.4\nbroken")),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining("损坏"),
  });
  await expect(
    parsePdfMaterial(Buffer.from("not a PDF")),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining("格式无效"),
  });
  await expect(
    parsePdfMaterial(makePdf(["private"], true)),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: expect.stringContaining("已加密"),
  });
});
