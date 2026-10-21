import { expect, it } from "vitest";
import { defaultCatalogs } from "../../packages/domain/admin";
import { intakeCandidates, parseDelimited } from "../../packages/domain/intake";
import { assistantProjectCsv } from "../../packages/domain/assistant-plan";
import { validateAssistantPlan } from "../../apps/api/src/ai/assistant-plan";
it("carries model-selected fields through structured import without natural-language parsing", () => {
  const source = "客户名字 重庆市市院，数字城市项目，地址是重庆，渠道龙赢";
  const plan = validateAssistantPlan(
    {
      kind: "project",
      rows: [
        {
          projectId: null,
          name: "数字城市项目",
          client: "重庆市市院",
          address: "重庆",
          channel: "龙赢",
          quote: source,
        },
      ],
    },
    { source, externalProcessingConfirmed: true },
    [],
  );
  if (plan.kind !== "project") throw new Error("Wrong fixture");
  const text = assistantProjectCsv(plan.rows, []);
  const catalog = {
    ...defaultCatalogs,
    channels: [
      ...(defaultCatalogs.channels ?? []),
      { id: "longying", name: "龙赢", shortName: "龙赢", archived: false },
    ],
  };
  const rows = intakeCandidates(
    { kind: "csv", name: "AI", sheet: "", text, rows: parseDelimited(text) },
    [],
    undefined,
    true,
    catalog,
  );
  expect(rows[0]!.project).toMatchObject({
    name: "数字城市项目",
    client: "重庆市市院",
    channelId: "longying",
    description: "地址：重庆",
  });
  expect(rows[0]!.task).toBeNull();
  expect(() =>
    intakeCandidates(
      { kind: "text", name: "原文", sheet: "", text: source },
      [],
    ),
  ).toThrow("AI 助手");
});
