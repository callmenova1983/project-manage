import { locationInstruction } from "./instructions.js";
import { z } from "zod";
import {
  projectCities,
  projectDistricts,
  cityLocation,
  districtLocation,
  type CityResolution,
} from "../../../../packages/domain/project-location.js";
import type { Project } from "../../../../packages/domain/types.js";
import type { QwenConfig } from "./config.js";
import { AiError } from "./provider.js";

/** Only existing project descriptive fields are sent for an explicit request. */
export function projectLocationContext(project: Project) {
  return {
    name: project.name,
    shortName: project.shortName ?? "",
    description: project.description,
    client: project.client,
    aliases: project.aliases,
  };
}

export function makeProjectLocationRequest(
  project: Project,
  config: QwenConfig,
) {
  return {
    model: config.model,
    stream: false,
    enable_thinking: false,
    enable_search: false,
    response_format: { type: "json_object" },
    max_tokens: Math.min(config.maxTokens, 1200),
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: locationInstruction,
      },
      {
        role: "user",
        content: JSON.stringify({
          project: projectLocationContext(project),
          cities: projectCities.map(({ id, name, province, aliases }) => ({
            id,
            name,
            province,
            aliases,
          })),
          districts: projectDistricts.map(({ id, name, cityId, aliases }) => ({
            id,
            name,
            cityId,
            aliases,
          })),
        }),
      },
    ],
  };
}

const outputSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            cityId: z.string().min(1).max(60),
            districtId: z.string().min(1).max(60).optional(),
            evidence: z.string().trim().min(2).max(500),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

export function validateProjectLocationAnalysis(
  value: unknown,
  project: Project,
): CityResolution {
  const result = outputSchema.safeParse(value);
  const invalid = () =>
    new AiError(
      502,
      "AI_INVALID_OUTPUT",
      "AI 返回了缺少项目原文依据或不受支持的城市或区县，请手动选择位置。",
    );
  if (!result.success) throw invalid();
  const context = projectLocationContext(project);
  const fields = [
    context.name,
    context.shortName,
    context.description,
    context.client,
    ...context.aliases,
  ];
  const seen = new Set<string>();
  const validated = result.data.candidates.map(
    ({ cityId, districtId, evidence }) => {
      const city = projectCities.find((item) => item.id === cityId);
      const district = districtId
        ? projectDistricts.find((item) => item.id === districtId)
        : undefined;
      const key = districtId ?? cityId;
      if (
        !city ||
        (districtId && (!district || district.cityId !== cityId)) ||
        seen.has(key) ||
        !fields.some((field) => field.includes(evidence))
      )
        throw invalid();
      seen.add(key);
      return {
        city,
        ...(district ? { district } : {}),
        evidence,
        location: district
          ? districtLocation(district.id, "ai", false, evidence)
          : cityLocation(city.id, "ai", false, evidence),
      };
    },
  );
  const candidates = validated;
  return {
    status:
      candidates.length === 1
        ? "matched"
        : candidates.length > 1
          ? "ambiguous"
          : "unmatched",
    candidates,
    location: candidates.length === 1 ? candidates[0]!.location : null,
  };
}
