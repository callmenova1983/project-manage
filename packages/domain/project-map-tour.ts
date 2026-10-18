import { locationKey, type ProjectLocation } from "./project-location.js";

export interface ProjectMapTourProject {
  id: string;
  location?: ProjectLocation | null;
}

interface TourEntry {
  id: string;
  group: string;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Build one repeatable round containing each located project exactly once.
 * Districts share their parent city; points without a city share only their
 * own coordinate key. The caller should retain this round while advancing.
 * Rebuilding after each step would discard the round's visitation guarantee.
 */
export function buildProjectMapTour(
  projects: readonly ProjectMapTourProject[],
  currentProjectId?: string | null,
): string[] {
  const entries = projects
    .filter(
      (
        project,
      ): project is ProjectMapTourProject & { location: ProjectLocation } =>
        Boolean(project.location),
    )
    .map(({ id, location }) => ({
      id,
      group: location.cityId
        ? `city:${location.cityId}`
        : locationKey(location),
    }))
    .sort((a, b) => compare(a.id, b.id) || compare(a.group, b.group));
  const seen = new Set<string>();
  const groups = new Map<string, TourEntry[]>();
  for (const entry of entries) {
    // Real project IDs are unique. Also avoid duplicate visits if a caller
    // temporarily merges overlapping filtered lists during a refresh.
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const group = groups.get(entry.group) ?? [];
    group.push(entry);
    groups.set(entry.group, group);
  }

  const orderedGroups = [...groups.entries()].sort(
    ([aKey, a], [bKey, b]) => b.length - a.length || compare(aKey, bKey),
  );
  const round: TourEntry[] = new Array(seen.size);
  let slot = 0;
  // Distribute the largest groups over alternate slots, then fill the gaps.
  // This also considers last -> first: a dominant city must have at least
  // max(0, 2 * largestGroup - total) same-city edges in any circular round.
  // This arrangement reaches that bound without starving smaller groups.
  for (const [, group] of orderedGroups) {
    for (const entry of group) {
      round[slot] = entry;
      slot += 2;
      if (slot >= round.length) slot = 1;
    }
  }

  let currentIndex = round.findIndex((entry) => entry.id === currentProjectId);
  if (currentIndex < 0) return round.map(({ id }) => id);
  const current = round[currentIndex]!;
  if (round[(currentIndex + 1) % round.length]!.group === current.group) {
    const outgoingIndex = round.findIndex(
      (entry, index) =>
        entry.group === current.group &&
        round[(index + 1) % round.length]!.group !== current.group,
    );
    if (outgoingIndex >= 0) {
      // Swap IDs within the same city so an arbitrary starting project can
      // leave its city immediately, without changing the optimal group ring.
      round[currentIndex] = round[outgoingIndex]!;
      round[outgoingIndex] = current;
      currentIndex = outgoingIndex;
    }
  }
  return [...round.slice(currentIndex), ...round.slice(0, currentIndex)].map(
    ({ id }) => id,
  );
}

/** Advance in a retained round; an absent current project starts at its head. */
export function nextProjectMapTourId(
  round: readonly string[],
  currentProjectId?: string | null,
): string | null {
  if (!round.length) return null;
  const index = currentProjectId == null ? -1 : round.indexOf(currentProjectId);
  return round[(index + 1) % round.length]!;
}
