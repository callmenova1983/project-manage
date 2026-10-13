import { pinyin } from "pinyin-pro";
import { suggestedLoginName } from "./login-name.js";
import type { Snapshot } from "./types.js";
export interface PersonChoice {
  name: string;
  employeeNo: string;
  department: string;
  position: string;
  group: "project" | "company";
  reasons: string[];
  tokens: string[];
  weight: number;
}
const cache = new Map<string, string[]>();
function nameTokens(name: string) {
  let result = cache.get(name);
  if (!result) {
    const words = pinyin(name, {
      type: "array",
      toneType: "none",
      surname: "head",
      v: true,
      traditional: true,
      nonZh: "consecutive",
    });
    result = [
      name.toLowerCase(),
      words.join("").toLowerCase(),
      words
        .map((w) => w[0] ?? "")
        .join("")
        .toLowerCase(),
      suggestedLoginName(name),
    ];
    cache.set(name, result);
  }
  return result;
}
export function peopleChoices(
  snapshot: Snapshot,
  projectId?: string,
): PersonChoice[] {
  const choices = new Map<string, PersonChoice>();
  const active = snapshot.directory?.employees.filter((e) => e.active) ?? [];
  const inactive = new Set(
    (snapshot.directory?.employees ?? [])
      .filter((e) => !e.active && !active.some((a) => a.name === e.name))
      .map((e) => e.name),
  );
  for (const person of active) {
    const department = person.departmentIds
      .map(
        (id) =>
          snapshot.directory?.departments.find((d) => d.id === id)?.name ?? "",
      )
      .filter(Boolean)
      .join(" · ");
    if (!choices.has(person.name))
      choices.set(person.name, {
        name: person.name,
        employeeNo: person.employeeNo,
        department,
        position: person.position,
        group: "company",
        reasons: [],
        tokens: [
          ...nameTokens(person.name),
          person.employeeNo.toLowerCase(),
          department.toLowerCase(),
          person.position.toLowerCase(),
        ],
        weight: 0,
      });
  }
  const related = (raw: string | undefined, reason: string, weight: number) => {
    const name = raw?.trim();
    if (
      !name ||
      name === "Unassigned" ||
      name === "未分配" ||
      inactive.has(name)
    )
      return;
    const person = choices.get(name) ?? {
      name,
      employeeNo: "",
      department: "",
      position: "",
      group: "project" as const,
      reasons: [],
      tokens: nameTokens(name),
      weight: 0,
    };
    person.group = "project";
    if (!person.reasons.includes(reason)) person.reasons.push(reason);
    person.weight = Math.max(person.weight, weight);
    choices.set(name, person);
  };
  if (projectId) {
    related(
      snapshot.projects.find((p) => p.id === projectId)?.owner,
      "Project owner",
      80,
    );
    for (const member of snapshot.projectMembers ?? [])
      if (member.projectId === projectId)
        related(member.name, "Project team", 90);
    const counts = new Map<string, number>();
    for (const task of snapshot.tasks)
      if (task.projectId === projectId && task.assignee.trim())
        counts.set(task.assignee, (counts.get(task.assignee) ?? 0) + 1);
    for (const [name, count] of counts)
      related(
        name,
        "Already assigned in this project",
        60 + Math.min(count, 20),
      );
  }
  return [...choices.values()].sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "zh-CN"),
  );
}
export function searchPeople(choices: PersonChoice[], query: string) {
  const key = query.toLowerCase().replace(/\s+/g, "");
  if (!key) return choices;
  return choices.filter((person) =>
    person.tokens.some((token) => token.replace(/\s+/g, "").includes(key)),
  );
}
