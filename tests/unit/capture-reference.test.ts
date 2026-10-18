import { expect, it } from "vitest";
import {
  classifyReferenceName,
  inferAttachmentPurpose,
} from "../../packages/domain/capture-reference";
import { validateReferenceClassification } from "../../apps/api/src/ai/capture-reference";
const files = [
  { id: "a87f7760-64f8-46db-93bb-4e60c0d0e001", name: "报价方案.docx" },
];
it("routes mixed references and meeting records independently, only asking about genuinely unknown files", () => {
  const note = "报价和现场照片归档，会议截图整理成待办";
  expect(inferAttachmentPurpose("北二码头报价.xlsx", note)).toBe("reference");
  expect(inferAttachmentPurpose("现场照片.jpg", note, true)).toBe("reference");
  expect(inferAttachmentPurpose("会议记录.png", note)).toBe("extract");
  expect(inferAttachmentPurpose("image.png", "", true)).toBe("extract");
  expect(inferAttachmentPurpose("IMG_1200.jpg", "")).toBe("unknown");
  expect(inferAttachmentPurpose("工作记录.txt", "")).toBe("extract");
});
it("distinguishes reference documents, site photos and execution evidence without guessing generic image filenames", () => {
  expect(classifyReferenceName("接口报价清单.xlsx")).toBe("quote");
  expect(classifyReferenceName("数字园区方案.docx")).toBe("proposal");
  expect(classifyReferenceName("现场勘察照片.jpg")).toBe("site-photo");
  expect(classifyReferenceName("任务执行凭证.png")).toBe("task-evidence");
  expect(classifyReferenceName("IMG_1234.jpg")).toBe("other");
});
it("rejects task creation, foreign project IDs and missing/duplicate file rows from classification output", () => {
  const row = { id: files[0]!.id, category: "quote", projectId: null };
  expect(validateReferenceClassification({ files: [row] }, files, [])).toEqual({
    files: [row],
  });
  expect(() =>
    validateReferenceClassification(
      { files: [row], tasks: [{ title: "报价第 1 行" }] },
      files,
      [],
    ),
  ).toThrow();
  expect(() =>
    validateReferenceClassification(
      { files: [{ ...row, projectId: "foreign" }] },
      files,
      [],
    ),
  ).toThrow();
  expect(() =>
    validateReferenceClassification({ files: [row, row] }, files, []),
  ).toThrow();
});
