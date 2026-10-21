import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { intakeCandidates } from "../../packages/domain/intake";
const examples = JSON.parse(
  readFileSync("tests/fixtures/intake-scenarios.json", "utf8"),
) as { text: string }[];
it("keeps the historical language corpus but never runs it through a rule parser", () => {
  expect(examples).toHaveLength(50);
  for (const example of examples)
    expect(() =>
      intakeCandidates(
        {
          kind: "text",
          name: "historical example",
          sheet: "",
          text: example.text,
        },
        [],
      ),
    ).toThrow("AI 助手");
});
