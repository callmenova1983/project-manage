import { suggest, type Project, type Proposal } from "./types.js";
import { meetingSections } from "./meeting-sections.js";

/** Repair only pending context. Never replay, delete or modify applied work. */
export function repairMeetingContext(
  proposal: Proposal,
  projects: Project[],
): Proposal {
  const consumed = new Set([
    ...(proposal.appliedSuggestionIds ?? []),
    ...(proposal.skippedSuggestionIds ?? []),
  ]);
  const skipped = new Set(proposal.skippedSuggestionIds ?? []);
  const sections = meetingSections(proposal.source);
  const contextual = suggest(proposal.source, projects);
  const headingSelections = new Map<string, Set<string>>();
  for (const item of proposal.suggestions) {
    const section = sections[item.sourceLine - 1];
    if (
      section?.isHeading &&
      item.selectedProjectId &&
      projects.some((p) => p.id === item.selectedProjectId)
    ) {
      const ids = headingSelections.get(section.heading) ?? new Set<string>();
      ids.add(item.selectedProjectId);
      headingSelections.set(section.heading, ids);
    }
  }
  return {
    ...proposal,
    suggestions: proposal.suggestions.map((item) => {
      if (consumed.has(item.id)) return item;
      const section = sections[item.sourceLine - 1];
      if (section?.isHeading) {
        skipped.add(item.id);
        return item;
      }
      const context = contextual.find(
        (entry) => entry.sourceLine === item.sourceLine,
      );
      if (!context?.sourceHeading) return item;
      const selected = headingSelections.get(context.sourceHeading);
      const inherited =
        selected?.size === 1
          ? [
              {
                projectId: [...selected][0]!,
                reason:
                  "Previously selected project for this exact source heading",
              },
            ]
          : [];
      return {
        ...item,
        sourceHeading: context.sourceHeading,
        candidates:
          context.sourceHeading === "其他项目（需明确）"
            ? []
            : context.candidates.length
              ? context.candidates
              : item.candidates.length
                ? item.candidates
                : inherited,
      };
    }),
    skippedSuggestionIds: [...skipped],
  };
}
