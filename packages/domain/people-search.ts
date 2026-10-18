import { pinyin } from "pinyin-pro";
import { suggestedLoginName } from "./login-name.js";
import type { Snapshot } from "./types.js";
export interface PersonChoice {
  key?: string;
  memberId?: string;
  name: string;
  employeeNo: string;
  department: string;
  position: string;
  group: "project" | "company";
  reasons: string[];
  tokens: string[];
  weight: number;
}

/** Selection identity is explicit; a matching name never links an account. */
export function assignmentChoices(
  snapshot: Snapshot,
  projectId?: string,
  retainedId?: string | null,
): PersonChoice[] {
  const members = snapshot.members ?? [];
  const employeeByUser = new Map(
    (snapshot.directory?.employees ?? [])
      .filter((person) => person.userId)
      .map((person) => [person.userId!, person]),
  );
  const departmentNames = new Map(
    (snapshot.directory?.departments ?? []).map((department) => [
      department.id,
      department.name,
    ]),
  );
  const projectMemberIds = new Set(
    (snapshot.projectMembers ?? [])
      .filter((person) => person.projectId === projectId)
      .map((person) => person.userId),
  );
  const owner = snapshot.projects.find(
    (project) => project.id === projectId,
  )?.ownerId;
  const result: PersonChoice[] = [];
  for (const member of members) {
    if (member.status !== "active" && member.id !== retainedId) continue;
    const employee = employeeByUser.get(member.id);
    const department =
      employee?.departmentIds
        .map((id) => departmentNames.get(id))
        .filter(Boolean)
        .join(" · ") ?? "";
    result.push({
      key: `member:${member.id}`,
      memberId: member.id,
      name: member.name,
      employeeNo: employee?.employeeNo ?? "",
      department,
      position: employee?.position ?? "",
      group:
        projectMemberIds.has(member.id) || owner === member.id
          ? "project"
          : "company",
      reasons: [
        member.status !== "active"
          ? "disabled"
          : projectMemberIds.has(member.id)
            ? "Project team"
            : "Linked member",
      ],
      tokens: [
        ...nameTokens(member.name),
        member.email.toLowerCase(),
        employee?.employeeNo.toLowerCase() ?? "",
        department.toLowerCase(),
      ],
      weight: projectMemberIds.has(member.id)
        ? 90
        : owner === member.id
          ? 80
          : 20,
    });
    // Email is a visible disambiguator for same-name accounts without directory details.
    if (!result[result.length - 1]!.position)
      result[result.length - 1]!.position = member.email;
  }
  const memberIds = new Set(members.map((member) => member.id));
  const knownNames = new Set(result.map((person) => person.name));
  for (const employee of snapshot.directory?.employees ?? []) {
    if (!employee.active || (employee.userId && memberIds.has(employee.userId)))
      continue;
    const department = employee.departmentIds
      .map((id) => departmentNames.get(id))
      .filter(Boolean)
      .join(" · ");
    result.push({
      key: `employee:${employee.id}`,
      name: employee.name,
      employeeNo: employee.employeeNo,
      department,
      position: employee.position,
      group: "company",
      reasons: ["Text only; no member is linked."],
      tokens: [
        ...nameTokens(employee.name),
        employee.employeeNo.toLowerCase(),
        department.toLowerCase(),
      ],
      weight: 0,
    });
    knownNames.add(employee.name);
  }
  for (const person of peopleChoices(snapshot, projectId)) {
    if (!knownNames.has(person.name)) {
      result.push({
        ...person,
        key: `text:${person.name}`,
        reasons: [...person.reasons, "Text only; no member is linked."],
      });
      knownNames.add(person.name);
    }
  }
  return result.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.name.localeCompare(b.name, "zh-CN") ||
      a.key!.localeCompare(b.key!),
  );
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
