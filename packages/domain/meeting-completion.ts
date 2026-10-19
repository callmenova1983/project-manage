import { z } from "zod";
import { hasUnspecifiedOtherProject } from "./meeting-sections.js";

/** Automatic matching must not undo an intentional ambiguity guard. */
export function meetingAutomaticProjects(
  item: Suggestion,
  projects: Project[],
) {
  if (hasUnspecifiedOtherProject(item.sourceText)) return [];
  return meetingReplyProjects(item.sourceText, projects);
}
import {
  projectInput,
  type Proposal,
  type Suggestion,
  type Project,
} from "./types.js";
import type { Channel } from "./channels.js";
import { captureTextFields, normalizeName } from "./intake-text.js";
import {
  defaultCatalogs,
  checkProjectCatalog,
  type Catalogs,
} from "./admin.js";
export const meetingNewProjectInput = z
  .object({
    suggestionId: z.string().min(1).max(100),
    suggestionIds: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(100)
      .optional(),
    name: projectInput.shape.name,
    channelId: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/),
    details: projectInput
      .pick({
        shortName: true,
        client: true,
        owner: true,
        stage: true,
        description: true,
        aliases: true,
      })
      .partial()
      .optional(),
    confirmed: z.literal(true),
  })
  .strict();
export type MeetingNewProject = z.infer<typeof meetingNewProjectInput>;
export function validateMeetingNewProjectSelection(
  input: MeetingNewProject,
  suggestions: { id: string; selectedProjectId: string }[],
) {
  const ids = input.suggestionIds ?? [input.suggestionId];
  if (
    !ids.includes(input.suggestionId) ||
    new Set(ids).size !== ids.length ||
    ids.length !== suggestions.length ||
    suggestions.some(
      (item) =>
        !ids.includes(item.id) || item.selectedProjectId !== "__new_project__",
    )
  )
    throw new Error("请确认要归入新项目的会议事项。");
}
export interface MeetingApplyOptions {
  partial?: true;
  skippedIds?: string[];
  updateMode?: "append";
  newProject?: MeetingNewProject;
}
const normalizedProjectName = (name: string) =>
  name.toLowerCase().replace(/\s+/g, "").replace(/项目$/, "");
export function meetingNewProjectFields(
  raw: MeetingNewProject,
  projects: Project[],
  channels: Channel[],
  catalog: Catalogs = defaultCatalogs,
) {
  const input = meetingNewProjectInput.parse(raw);
  if (
    projects.some(
      (project) =>
        !project.intakeInbox &&
        [project.name, project.shortName ?? "", ...project.aliases].some(
          (name) =>
            name &&
            normalizedProjectName(name) === normalizedProjectName(input.name),
        ),
    )
  )
    throw new Error("已有同名项目，请选择已有项目，避免重复创建。");
  if (
    !channels.some(
      (channel) => channel.id === input.channelId && !channel.archived,
    )
  )
    throw new Error("请选择可用渠道后再创建项目。");
  const project = projectInput.parse({
    name: input.name,
    channelId: input.channelId,
    client: "",
    description: "",
    stage: "unclassified",
    owner: "",
    discipline: "Unassigned",
    latestUpdate: "",
    notes: "",
    aliases: [],
    ...input.details,
  });
  checkProjectCatalog(project, { ...catalog, channels });
  return project;
}
export function meetingReplyDraft(
  reply: string,
  channels: Channel[],
  catalog: Catalogs = defaultCatalogs,
) {
  const issues: string[] = [];
  const fields = captureTextFields(reply.replace(/\r?\n/g, "；"), issues);
  const clauses = reply
    .split(/[,，;；\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const project = (
    clauses.find((value) => !/^(?:渠道|如果|若|没有|找不到)/.test(value)) ?? ""
  ).replace(/^\d+[.、)）]\s*/, "");
  const name =
    fields.project ||
    project
      .replace(
        /^(?:(?:请|帮我)?(?:新建|创建|建立)(?:一个)?(?:项目[：:\s])?|(?:归到|归入|属于|项目(?:名称|名)?[：:是为]))\s*/,
        "",
      )
      .split(/[：:]/)[0]!
      .split(/\s+(?=渠道|客户|负责人|项目负责人|阶段|简称|别名)/)[0]!
      .replace(/[。.!！]+$/, "")
      .trim();
  const channelName = (
    fields.channel ??
    clauses
      .map((value) =>
        value.match(/^渠道(?:是|为|[：:])?\s*(.+?)[。.!！]?$/)?.[1]?.trim(),
      )
      .find(Boolean) ??
    ""
  )
    .split(/[;；，,]/)[0]!
    .trim();
  const channel = channels.find(
    (channel) =>
      !channel.archived &&
      [channel.id, channel.name, channel.shortName].some(
        (name) => normalizeName(name) === normalizeName(channelName),
      ),
  );
  const stage = fields.stage
    ? catalog.stages.find(
        (stage) =>
          !stage.archived &&
          [stage.id, stage.en, stage.zh].some(
            (name) =>
              normalizeName(name).replace(/[与&\s]/g, "") ===
              normalizeName(fields.stage!).replace(/[与&\s]/g, ""),
          ),
      )?.id
    : undefined;
  return {
    name: name.length <= 120 ? name : "",
    channelId:
      channel?.id ??
      (Object.hasOwn(fields, "channel") || channelName ? "" : "company"),
    unmatchedChannel: channelName && !channel ? channelName : "",
    unmatchedStage: fields.stage && !stage ? fields.stage : "",
    issues,
    details: {
      client: fields.client ?? "",
      owner: fields.owner ?? "",
      shortName: fields.shortName ?? "",
      description: fields.description ?? "",
      stage: stage ?? (fields.stage ? "" : "unclassified"),
      aliases:
        fields.aliases
          ?.split(/[、，,|]/)
          .map((name) => name.trim())
          .filter(Boolean) ?? [],
    },
  };
}
export function pendingMeetingItems(proposal: Proposal) {
  const consumed = new Set([
    ...(proposal.appliedSuggestionIds ?? []),
    ...(proposal.skippedSuggestionIds ?? []),
  ]);
  return proposal.suggestions.filter((s) => !consumed.has(s.id));
}
export function validateMeetingSelection(
  proposal: Proposal,
  ids: string[],
  skipped: string[],
) {
  const all = [...ids, ...skipped];
  if (!all.length || new Set(all).size !== all.length)
    throw new Error("Choose distinct meeting items");
  const pending = new Set(pendingMeetingItems(proposal).map((s) => s.id));
  if (all.some((id) => !pending.has(id)))
    throw new Error("Meeting item is missing or already recorded");
}
export function settleMeetingProposal(
  proposal: Proposal,
  saved: Suggestion[],
  options: MeetingApplyOptions,
  results: Pick<Proposal, "appliedResults" | "createdProjectIds"> = {},
): Proposal {
  const receipts = {
    appliedResults: [
      ...new Map(
        [
          ...(proposal.appliedResults ?? []),
          ...(results.appliedResults ?? []),
        ].map((item) => [item.suggestionId, item] as const),
      ).values(),
    ],
    createdProjectIds: [
      ...new Set([
        ...(proposal.createdProjectIds ?? []),
        ...(results.createdProjectIds ?? []),
      ]),
    ],
  };
  if (!options.partial)
    return {
      ...proposal,
      ...receipts,
      status: "applied",
      suggestions: saved,
      appliedAt: new Date().toISOString(),
    };
  const appliedSuggestionIds = [
    ...(proposal.appliedSuggestionIds ?? []),
    ...saved.map((s) => s.id),
  ];
  const skippedSuggestionIds = [
    ...(proposal.skippedSuggestionIds ?? []),
    ...(options.skippedIds ?? []),
  ];
  const consumed = new Set([...appliedSuggestionIds, ...skippedSuggestionIds]);
  const complete = proposal.suggestions.every((s) => consumed.has(s.id));
  return {
    ...proposal,
    ...receipts,
    suggestions: proposal.suggestions.map(
      (s) => saved.find((item) => item.id === s.id) ?? s,
    ),
    appliedSuggestionIds,
    skippedSuggestionIds,
    status: complete ? "applied" : "draft",
    ...(complete ? { appliedAt: new Date().toISOString() } : {}),
  };
}
export function meetingReplyProjects(reply: string, projects: Project[]) {
  const normalized = reply
    .split(/[,，;；\n]/)
    .filter((value) => !/^\s*(?:渠道|如果|若|没有|找不到)/.test(value))
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "");
  return projects.filter((p) =>
    [p.name, p.shortName ?? "", ...p.aliases].some((name) => {
      const key = normalizedProjectName(name);
      return (
        key &&
        (normalized === key || (key.length >= 2 && normalized.includes(key)))
      );
    }),
  );
}
export function groupMeetingItems(items: Suggestion[], projects: Project[]) {
  const clean = (text: string) =>
    text.replace(/^\s*(?:[-•]|\d+[.、)）])\s*/, "").trim();
  const lines = items.map((item) => clean(item.sourceText));
  const generic =
    /^(?:本周|下周|今天|明天|后续|继续|完成|确认|跟进|协助|计划|安排|需要|要求|关于|会议|项目|我们|进行|Review\b|Confirm\b|Update\b|The\b)/i;
  const prefixes = new Map<string, number>();
  for (const line of lines)
    for (let size = 2; size <= Math.min(16, line.length); size++) {
      const prefix = line.slice(0, size);
      if (
        !generic.test(prefix) &&
        /^[\p{Script=Han}A-Za-z0-9 _-]+$/u.test(prefix)
      )
        prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
  const repeated = [...prefixes]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const groups: { key: string; name: string; items: Suggestion[] }[] = [];
  items.forEach((item, index) => {
    if (item.sourceHeading) {
      const candidates = item.candidates
        .map((candidate) => candidate.projectId)
        .sort()
        .join(",");
      const key = `section:${item.sourceHeading}:${candidates}`;
      const group = groups.find((entry) => entry.key === key);
      if (group) group.items.push(item);
      else groups.push({ key, name: item.sourceHeading, items: [item] });
      return;
    }
    const line = lines[index]!;
    const explicit =
      captureTextFields(line).project ||
      line.match(/^(.{2,24}?项目)(?:[：:\s]|[\p{Script=Han}]|$)/u)?.[1];
    const shared = repeated
      .find(([prefix]) => line.startsWith(prefix))?.[0]
      ?.trim();
    const organization = line.match(
      /^(.{2,16}?(?:公司|集团|工厂|学校|医院|园区|大厦))(?=\S|$)/,
    )?.[1];
    const domain = line.match(
      /^([\p{Script=Han}A-Za-z0-9_-]{2,16}?)(?=安消|能耗|地下室|照明|平台|系统|传感器|智能化|设备|工程|验收|现场|报价|招标)/u,
    )?.[1];
    const label = explicit || shared || organization || domain || "";
    const name = label && !generic.test(label) ? label : "";
    const known = item.candidates.some((candidate) =>
      projects.some((project) => project.id === candidate.projectId),
    );
    const key = known || !name ? item.id : normalizedProjectName(name);
    const group = groups.find((group) => group.key === key);
    if (group) group.items.push(item);
    else groups.push({ key, name: known ? "" : name, items: [item] });
  });
  return groups;
}
