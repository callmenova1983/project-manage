import { expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";
import { parseMaterial } from "../../apps/api/src/progress-materials";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=",
  "base64",
);
const unsupported = strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>');
function word(text: string, media: Record<string, Uint8Array>) {
  return Buffer.from(
    zipSync({
      "word/document.xml": strToU8(
        `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      ),
      ...Object.fromEntries(
        Object.entries(media).map(([name, data]) => [
          `word/media/${name}`,
          data,
        ]),
      ),
    }),
  );
}

it("keeps Word text and supported pictures when other embedded pictures are unsupported", async () => {
  const result = await parseMaterial(
    "项目.docx",
    word("智慧园区设备安装完成", {
      "diagram.svg": unsupported,
      "legacy.emf": strToU8("unsupported embedded metafile"),
      "photo.png": png,
    }),
  );
  expect(result.kind).toBe("word");
  expect(result.text).toContain("智慧园区设备安装完成");
  expect(result.images).toEqual([
    `data:image/png;base64,${png.toString("base64")}`,
  ]);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain("unsupported format");
  expect(result.warnings[0]).toContain("original attachment is preserved");
});

it("keeps Excel rows when a workbook contains an unsupported embedded picture", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["项目", "进展"],
      ["智慧园区", "设备安装完成"],
    ]),
    "项目",
  );
  const zip = unzipSync(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  zip["xl/media/diagram.svg"] = unsupported;
  zip["xl/media/photo.png"] = png;
  const result = await parseMaterial("项目.xlsx", Buffer.from(zipSync(zip)));
  expect(result.kind).toBe("excel");
  expect(result.text).toContain("智慧园区\t设备安装完成");
  expect(result.images).toHaveLength(1);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain("unsupported format");
});

it("keeps readable content and warns when a document has more than six supported pictures", async () => {
  const result = await parseMaterial(
    "项目.docx",
    word(
      "保留完整文字",
      Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`photo-${index}.png`, png]),
      ),
    ),
  );
  expect(result.text).toContain("保留完整文字");
  expect(result.images).toHaveLength(6);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain("first 6 embedded pictures");
});

it("still rejects documents that have no readable text or supported pictures", async () => {
  await expect(
    parseMaterial("空白.docx", word("", { "diagram.svg": unsupported })),
  ).rejects.toThrow("No readable content was found");
});

it("still enforces the embedded image size limit after the first six pictures", async () => {
  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
  png.copy(oversized);
  await expect(
    parseMaterial(
      "项目.docx",
      word("项目文字", {
        ...Object.fromEntries(
          Array.from({ length: 6 }, (_, index) => [`photo-${index}.png`, png]),
        ),
        "oversized.png": oversized,
      }),
    ),
  ).rejects.toThrow("An embedded image exceeds 8 MB");
});

it("retains the exact original Office attachment after accepting unsupported embedded pictures", async () => {
  const origin = "http://localhost:4173";
  const ctx = await buildApp({ databasePath: ":memory:", origin });
  try {
    ctx.repo.seed("office");
    const password = randomBytes(24).toString("hex");
    await createUser(ctx.repo, {
      workspaceId: "office",
      name: "Office tester",
      email: "office@example.test",
      password,
    });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "office@example.test", password },
    });
    const headers = {
      cookie: `pm_session=${login.cookies[0]!.value}`,
      origin,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": randomUUID(),
    };
    const bytes = word("项目原文应保留", { "diagram.svg": unsupported });
    const upload = await ctx.app.inject({
      method: "POST",
      url: "/api/capture/materials",
      headers,
      payload: { name: "项目.docx", data: bytes.toString("base64") },
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().text).toContain("项目原文应保留");
    expect(upload.json().warnings).toHaveLength(1);
    const download = await ctx.app.inject({
      method: "GET",
      url: `/api/capture/materials/${upload.json().id}`,
      headers,
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(bytes);
  } finally {
    await ctx.app.close();
  }
});
