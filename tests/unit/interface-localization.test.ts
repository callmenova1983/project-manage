import { afterEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import {
  baseParse,
  type RootNode,
  type TemplateChildNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { locale, t } from "../../apps/web/src/locales";
import { uiEnglish } from "../../apps/web/src/locales/ui-en";
import {
  answerAssistantQuery,
  assistantQueryInput,
} from "../../packages/domain/assistant";
import { createSeed } from "../../packages/domain/seed";

const han = /[\p{Script=Han}]/u;
const originalLocale = locale.value;
afterEach(() => {
  locale.value = originalLocale;
});

describe("complete interface localization", () => {
  it("covers registered interface messages without altering inserted business data", () => {
    locale.value = "en";
    for (const [source, english] of Object.entries(uiEnglish)) {
      expect(t(source), source).toBe(english);
      expect(han.test(english), source).toBe(false);
      const placeholders = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(english), source).toEqual(placeholders(source));
    }
    expect(t("当前项目：{p0}", { p0: "中文项目·公司" })).toBe(
      "Current project: 中文项目·公司",
    );
    expect(t("Expand {name}", { name: "批量编辑信息" })).toBe(
      "Expand 批量编辑信息",
    );
  });

  it("updates mounted UI labels in both directions and localizes service errors", () => {
    const label = computed(() => t("批量编辑信息"));
    locale.value = "zh-CN";
    expect(label.value).toBe("批量编辑信息");
    locale.value = "en";
    expect(label.value).toBe("Bulk edit information");
    expect(
      t("第 3 行阶段“业务阶段原文”无法识别，请使用表格中的阶段名称。"),
    ).toBe(
      "Stage “业务阶段原文” in row 3 was not recognized. Use a stage name from the table.",
    );
    expect(t("语音识别需要团队工作区；演示模式不会发送录音。")).not.toMatch(
      han,
    );
    locale.value = "zh-CN";
    expect(label.value).toBe("批量编辑信息");
    expect(t("Bulk edit information")).toBe("批量编辑信息");
  });

  it("does not allow new untranslated Chinese text or static interface attributes in Vue templates", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(resolve(dir, entry.name))
          : [resolve(dir, entry.name)],
      );
    const issues: string[] = [];
    for (const file of files(resolve("apps/web/src")).filter((file) =>
      file.endsWith(".vue"),
    )) {
      const { descriptor } = parse(readFileSync(file, "utf8"));
      if (!descriptor.template) continue;
      const visit = (
        node: RootNode | TemplateChildNode,
        languageOption = false,
      ) => {
        if (
          node.type === NodeTypes.TEXT &&
          han.test(node.content) &&
          !languageOption
        )
          issues.push(`${file}: ${node.content.trim()}`);
        if (node.type === NodeTypes.ELEMENT) {
          languageOption =
            node.tag === "option" &&
            node.props.some(
              (prop) =>
                prop.type === NodeTypes.ATTRIBUTE &&
                prop.name === "value" &&
                prop.value?.content === "zh-CN",
            );
          for (const prop of node.props)
            if (
              prop.type === NodeTypes.ATTRIBUTE &&
              [
                "aria-label",
                "title",
                "placeholder",
                "label",
                "description",
              ].includes(prop.name) &&
              prop.value &&
              han.test(prop.value.content)
            )
              issues.push(`${file}: ${prop.name}=${prop.value.content}`);
        }
        if ("children" in node)
          for (const child of node.children)
            if (typeof child === "object")
              visit(child as TemplateChildNode, languageOption);
      };
      visit(baseParse(descriptor.template.content));
    }
    expect(issues).toEqual([]);
  });

  it("responds to English assistant queries in English while preserving source content", () => {
    const now = new Date("2026-10-17T08:00:00Z");
    const snapshot = createSeed(now);
    const actor = { id: "demo", name: "Demo" };
    for (const text of [
      "What tasks are planned this week?",
      "Show all projects",
      "What is the status of Atlas Customer Portal?",
    ]) {
      const input = assistantQueryInput.parse({ text, locale: "en" });
      const answer = answerAssistantQuery(input, snapshot, actor, now);
      expect(answer.handled).toBe(true);
      expect(answer.text).not.toMatch(han);
      for (const link of answer.links) expect(link.detail).not.toMatch(han);
    }
    const project = snapshot.projects[0]!;
    project.latestUpdate = "客户原文：中文进展保持原样";
    const answer = answerAssistantQuery(
      { text: `What is the status of ${project.name}?`, locale: "en" },
      snapshot,
      actor,
      now,
    );
    expect(answer.text).toContain(project.latestUpdate);
    expect(answer.text).toContain("Owner:");
    const legacy = answerAssistantQuery(
      { text: "今天有哪些待办？" },
      snapshot,
      actor,
      now,
    );
    expect(legacy.text).toMatch(han);
  });
});
