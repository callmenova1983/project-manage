import { z } from "zod";
import {
  projectInput,
  type Proposal,
  type Suggestion,
  type Project,
} from "./types.js";
import type { Channel } from "./channels.js";
import { normalizeName } from "./intake-text.js";
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
const normalizedProjectName = (name: string) => normalizeName(name);
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
/** An explicit empty form; it never interprets the user's reply. */
export function emptyMeetingProjectDraft() {
  return {
    name: "",
    channelId: "company",
    unmatchedChannel: "",
    unmatchedStage: "",
    issues: [] as string[],
    details: {
      client: "",
      owner: "",
      shortName: "",
      description: "",
      stage: "unclassified",
      aliases: [] as string[],
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
/** Group only model-provided project labels and IDs. Never derive names from prose. */
export function groupMeetingItems(items: Suggestion[]) {
  const groups = new Map<
    string,
    { key: string; name: string; items: Suggestion[] }
  >();
  for (const item of items) {
    const ids = item.candidates.map((candidate) => candidate.projectId).sort();
    const key = item.sourceHeading
      ? JSON.stringify([item.sourceHeading, ids])
      : ids.length
        ? JSON.stringify(ids)
        : item.id;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else
      groups.set(key, { key, name: item.sourceHeading ?? "", items: [item] });
  }
  return [...groups.values()];
}
