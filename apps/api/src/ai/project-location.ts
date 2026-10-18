import { locationInstruction } from './instructions.js';
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
        content:
          locationInstruction,
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
  // The model may redundantly quote the city as context for a finer result.
  // Keep a separate city candidate when its quote identifies another project
  // or an unsupported county, so unrelated evidence is not silently discarded.
  const candidates = validated.filter((candidate) => {
    if (candidate.district) return true;
    const finer = validated.filter(
      (other) => other.district && other.city.id === candidate.city.id,
    );
    if (!finer.length) return true;
    const parentNames = [
      candidate.city.name,
      `${candidate.city.name}市`,
      candidate.city.id,
    ];
    const mentionsAnotherCounty = candidate.city.aliases.some(
      (alias) =>
        !parentNames.includes(alias) &&
        candidate.evidence.includes(alias) &&
        !finer.some((other) => other.district!.aliases.includes(alias)),
    );
    if (mentionsAnotherCounty) return true;
    return !(
      parentNames.includes(candidate.evidence) ||
      finer.some(
        (other) =>
          other.evidence.includes(candidate.evidence) ||
          other.district!.aliases.some((alias) =>
            candidate.evidence.includes(alias),
          ),
      )
    );
  });
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
