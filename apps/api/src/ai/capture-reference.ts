import { referenceInstruction } from './instructions.js';
import {
  referenceClassificationSchema,
  classifyReferenceName,
  type ReferenceClassification,
} from "../../../../packages/domain/capture-reference.js";
import type { Project } from "../../../../packages/domain/types.js";
import type { QwenConfig } from "./config.js";
export type ReferenceName = { id: string; name: string };
export function referenceContext(
  files: ReferenceName[],
  notes: string,
  projects: Project[],
) {
  return {
    files,
    notes,
    projects: projects
      .filter((p) => !p.intakeInbox)
      .map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases,
        shortName: p.shortName,
      })),
  };
}
export function localReferenceClassification(
  files: ReferenceName[],
  notes: string,
  projects: Project[],
): ReferenceClassification {
  return {
    provider: "rules",
    model: null,
    files: files.map((file) => {
      const context = `${file.name} ${notes}`;
      const matches = projects.filter(
        (p) =>
          !p.intakeInbox &&
          [p.name, p.shortName, ...p.aliases].some(
            (name) => name && name.length >= 2 && context.includes(name),
          ),
      );
      const category = classifyReferenceName(file.name);
      return {
        id: file.id,
        category:
          category === "other" ? classifyReferenceName(notes) : category,
        projectId: matches.length === 1 ? matches[0]!.id : null,
      };
    }),
  };
}
export function makeReferenceRequest(source: string, config: QwenConfig) {
  if (source.length > 24000) throw Error("项目名称过多，请先选择归档项目。");
  return {
    model: config.model,
    stream: false,
    enable_thinking: false,
    enable_search: false,
    response_format: { type: "json_object" },
    max_tokens: Math.min(1024, config.maxTokens),
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          referenceInstruction,
      },
      { role: "user", content: source },
    ],
  };
}
export function validateReferenceClassification(
  value: unknown,
  files: ReferenceName[],
  projects: Project[],
) {
  const result = referenceClassificationSchema.parse(value);
  if (
    result.files.length !== files.length ||
    result.files.some(
      (file, i) =>
        file.id !== files[i]!.id ||
        (file.projectId !== null &&
          !projects.some((p) => p.id === file.projectId && !p.intakeInbox)),
    )
  )
    throw Error("文件分类结果不匹配，请手动选择类别。");
  return result;
}
