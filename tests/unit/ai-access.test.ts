import { expect, it } from "vitest";
import { aiAccessInstructions } from "../../packages/domain/ai-access";

it("copies the current public system origin and Bearer header without selecting any project", () => {
  const text = aiAccessInstructions(
    "https://pm.example.test:8443/projects/old-project",
    "test-token",
  );
  expect(text).toContain("系统地址：https://pm.example.test:8443");
  expect(text).toContain("Authorization: Bearer test-token");
  expect(text).toContain("https://pm.example.test:8443/api/ai-access/docs");
  expect(text).toContain(
    "GET https://pm.example.test:8443/api/ai-access/context",
  );
  expect(text).toContain("所有可访问的项目列表及任务概况");
  expect(text).not.toContain("old-project");
  expect(text).not.toContain("项目 ID：");
});
