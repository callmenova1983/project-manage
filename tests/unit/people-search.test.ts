import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { emptyDirectory } from "../../packages/domain/directory";
import {
  peopleChoices,
  searchPeople,
} from "../../packages/domain/people-search";
import type { Snapshot } from "../../packages/domain/types";
it("matches Chinese, full pinyin, initials, surname login and employee number", () => {
  const seed = createSeed(),
    s: Snapshot = {
      ...seed,
      schemaVersion: 2,
      revision: 1,
      directory: emptyDirectory(),
    };
  s.directory!.employees.push({
    id: "zyj",
    name: "郑元杰",
    employeeNo: "NGB001",
    position: "总经理",
    departmentIds: [],
    email: "",
    wecomUserId: "",
    userId: null,
    source: "manual",
    active: true,
  });
  const choices = peopleChoices(s);
  for (const q of ["郑", "zhengyuanjie", "zyj", " ZHENG YJ ", "ngb001"])
    expect(searchPeople(choices, q).map((p) => p.name)).toEqual(["郑元杰"]);
  expect(searchPeople(choices, "no-one")).toHaveLength(0);
});
it("recommends actual editors and assignees while excluding unavailable people and placeholders", () => {
  const seed = createSeed(),
    s: Snapshot = {
      ...seed,
      schemaVersion: 2,
      revision: 1,
      directory: emptyDirectory(),
      projectMembers: [],
    };
  const p = s.projects[0]!;
  p.owner = "Unassigned";
  s.tasks = s.tasks.filter((t) => t.projectId !== p.id);
  s.tasks.push({ ...seed.tasks[0]!, projectId: p.id, assignee: "外部顾问" });
  s.projectMembers!.push({
    projectId: p.id,
    userId: "x",
    name: "郑元杰",
    department: "",
    position: "",
    joinedAt: "2026-10-13T00:00:00Z",
    lastEditedAt: "2026-10-13T00:00:00Z",
  });
  const person = (name: string, active: boolean) => ({
    id: name,
    name,
    active,
    employeeNo: "",
    position: "",
    departmentIds: [],
    email: "",
    wecomUserId: "",
    userId: null,
    source: "manual" as const,
  });
  s.directory!.employees.push(
    person("郑元杰", true),
    person("已停用", false),
    person("李峰", true),
  );
  p.owner = "已停用";
  const result = peopleChoices(s, p.id);
  expect(result.map((p) => p.name)).toEqual(["郑元杰", "外部顾问", "李峰"]);
  expect(result[0]!.group).toBe("project");
  expect(searchPeople(result, "wbgw")[0]!.name).toBe("外部顾问");
});
