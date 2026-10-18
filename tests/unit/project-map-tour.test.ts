import { describe, expect, it } from "vitest";
import {
  cityLocation,
  districtLocation,
  locationKey,
  pointLocation,
} from "../../packages/domain/project-location";
import {
  buildProjectMapTour,
  nextProjectMapTourId,
  type ProjectMapTourProject,
} from "../../packages/domain/project-map-tour";

const cities = ["ningbo", "shanghai", "hangzhou"];
function cityProjects(counts: readonly number[]): ProjectMapTourProject[] {
  return counts.flatMap((count, group) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${cities[group]}-${index}`,
      location: cityLocation(cities[group]!, "text", true),
    })),
  );
}
function projectGroup(project: ProjectMapTourProject): string {
  return project.location!.cityId || locationKey(project.location!);
}
function sameGroupEdges(
  order: readonly string[],
  projects: readonly ProjectMapTourProject[],
): number {
  const groups = new Map(
    projects.map((project) => [project.id, projectGroup(project)]),
  );
  return order.filter(
    (id, index) =>
      groups.get(id) === groups.get(order[(index + 1) % order.length]!),
  ).length;
}

describe("project map tour", () => {
  it("visits each located project once, with city and district positions in the same city group", () => {
    const projects: ProjectMapTourProject[] = [
      { id: "n-city", location: cityLocation("ningbo", "name") },
      { id: "n-beilun", location: districtLocation("ningbo-beilun", "name") },
      { id: "n-yinzhou", location: districtLocation("ningbo-yinzhou", "name") },
      { id: "s-1", location: cityLocation("shanghai", "name") },
      { id: "s-2", location: cityLocation("shanghai", "text", true) },
      { id: "h-1", location: cityLocation("hangzhou", "text", true) },
      { id: "unlocated" },
      { id: "cleared", location: null },
    ];
    const located = projects.filter((project) => project.location);
    const order = buildProjectMapTour(projects);
    expect([...order].sort()).toEqual(located.map(({ id }) => id).sort());
    expect(new Set(order).size).toBe(6);
    // A3 B2 C1 can avoid equal neighbours across the entire circular route.
    expect(sameGroupEdges(order, located)).toBe(0);
  });

  it("starts at any current project, leaves its city next, and preserves the optimal circular route", () => {
    for (const counts of [
      [3, 2, 1],
      [7, 2, 1],
      [4, 1, 0],
    ]) {
      const projects = cityProjects(counts);
      for (const project of projects) {
        const order = buildProjectMapTour(projects, project.id);
        expect(order[0]).toBe(project.id);
        expect(
          projectGroup(projects.find(({ id }) => id === order[1])!),
        ).not.toBe(projectGroup(project));
        expect([...order].sort()).toEqual(projects.map(({ id }) => id).sort());
        expect(sameGroupEdges(order, projects)).toBe(
          Math.max(0, 2 * Math.max(...counts) - order.length),
        );
      }
    }
  });

  it("retains every project over repeated rounds even with a dominant city", () => {
    const projects = cityProjects([8, 1, 1]);
    const order = buildProjectMapTour(projects, "ningbo-3");
    let current = order[0]!;
    for (let round = 0; round < 3; round++) {
      const visited: string[] = [];
      for (let step = 0; step < order.length; step++) {
        visited.push(current);
        current = nextProjectMapTourId(order, current)!;
      }
      expect([...visited].sort()).toEqual(projects.map(({ id }) => id).sort());
      expect(current).toBe(order[0]);
    }
  });

  it("is deterministic across input order and does not mutate input projects", () => {
    const projects = cityProjects([3, 2, 2]);
    for (const project of projects) {
      Object.freeze(project.location);
      Object.freeze(project);
    }
    Object.freeze(projects);
    const first = buildProjectMapTour(projects, "ningbo-1");
    expect(buildProjectMapTour([...projects].reverse(), "ningbo-1")).toEqual(
      first,
    );
    expect(buildProjectMapTour(projects, "ningbo-1")).toEqual(first);
  });

  it("groups unidentified-city points by coordinate key instead of treating all points as one city", () => {
    const a = pointLocation(29.9, 121.8, "map");
    const b = pointLocation(30.2, 120.1, "text");
    const projects: ProjectMapTourProject[] = [
      { id: "a1", location: a },
      { id: "a2", location: a },
      { id: "b1", location: b },
      { id: "b2", location: b },
    ];
    const order = buildProjectMapTour(projects, "a2");
    expect(order[0]).toBe("a2");
    expect(sameGroupEdges(order, projects)).toBe(0);
    expect(new Set(order)).toEqual(new Set(["a1", "a2", "b1", "b2"]));
  });

  it("handles empty, single-project, single-city, missing selection and duplicate inputs", () => {
    expect(buildProjectMapTour([{ id: "unknown" }], "unknown")).toEqual([]);
    expect(nextProjectMapTourId([], "unknown")).toBeNull();
    const one = cityProjects([1]);
    expect(buildProjectMapTour(one, one[0]!.id)).toEqual([one[0]!.id]);
    expect(nextProjectMapTourId([one[0]!.id], one[0]!.id)).toBe(one[0]!.id);
    const projects = cityProjects([4]);
    const order = buildProjectMapTour(projects, projects[2]!.id);
    expect(order[0]).toBe(projects[2]!.id);
    expect([...order].sort()).toEqual(projects.map(({ id }) => id).sort());
    expect(nextProjectMapTourId(order, "removed")).toBe(order[0]);
    expect(nextProjectMapTourId(order, order.at(-1))).toBe(order[0]);
    expect(buildProjectMapTour([...projects, ...projects])).toEqual(
      buildProjectMapTour(projects),
    );
    expect(buildProjectMapTour(projects, "removed")).toEqual(
      buildProjectMapTour(projects),
    );
  });

  it("has no avoidable same-city circular edges across balanced and imbalanced distributions", () => {
    // Any city with M projects needs at least 2*M-N same-city edges when
    // it outnumbers all other projects. The complete round achieves this
    // lower bound, including its wraparound edge, for every tested mix.
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 0; c <= 4; c++) {
          const projects = cityProjects([a, b, c]);
          const order = buildProjectMapTour(projects);
          expect(sameGroupEdges(order, projects)).toBe(
            Math.max(0, 2 * Math.max(a, b, c) - order.length),
          );
          expect(new Set(order).size).toBe(projects.length);
        }
      }
    }
  });
});
