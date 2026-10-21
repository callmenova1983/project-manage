import { expect, it } from "vitest";
import { answerAssistantPlan } from "../../packages/domain/assistant-plan";
import { createSeed } from "../../packages/domain/seed";
it("reads real records using model-selected filters without interpreting natural language", () => {
  const snapshot = createSeed();
  const project = snapshot.projects[0]!;
  const before = structuredClone(snapshot);
  const answer = answerAssistantPlan(
    {
      kind: "query",
      entity: "projects",
      projectIds: [project.id],
      status: "all",
      range: "all",
    },
    snapshot,
    { id: "tester", name: "Tester" },
  );
  expect(answer.links).toHaveLength(1);
  expect(answer.links[0]!.title).toBe(project.name);
  expect(snapshot).toEqual(before);
});
