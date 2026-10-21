import { expect, it } from "vitest";

import { validateReferenceClassification } from "../../apps/api/src/ai/capture-reference";
const files = [
  { id: "a87f7760-64f8-46db-93bb-4e60c0d0e001", name: "报价方案.docx" },
];
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
