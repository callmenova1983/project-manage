import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { createSeed } from "../dist/server/packages/domain/seed.js";
import { validateGraph } from "../dist/server/packages/domain/types.js";
import { directorySchema } from "../dist/server/packages/domain/directory.js";
import { projectPeopleWork } from "../dist/server/packages/domain/people-work.js";

const seed = createSeed(new Date("2026-10-17T00:00:00Z"));
const base = seed.tasks.find(
  (task) => !seed.tasks.some((child) => child.parentId === task.id),
);
const projects = Array.from({ length: 200 }, (_, i) => ({
  ...seed.projects[i % seed.projects.length],
  id: `people-project-${i}`,
  name: `Synthetic project ${i}`,
}));
const members = Array.from({ length: 2500 }, (_, i) => ({
  id: `people-member-${i}`,
  name: `Synthetic person ${String(i).padStart(4, "0")}`,
  email: `person${i}@example.test`,
  status: i % 50 === 0 ? "disabled" : "active",
}));
const directory = directorySchema.parse({
  version: 1,
  companyName: "Synthetic benchmark",
  lastSyncedAt: null,
  departments: Array.from({ length: 100 }, (_, i) => ({
    id: `department-${i}`,
    name: `Department ${i}`,
    parentId: i ? "department-0" : null,
    wecomId: null,
  })),
  employees: Array.from({ length: 5000 }, (_, i) => ({
    id: `people-employee-${i}`,
    employeeNo: `E${String(i).padStart(5, "0")}`,
    name: `Synthetic person ${String(i).padStart(4, "0")}`,
    departmentIds:
      i % 2
        ? [`department-${i % 100}`]
        : ["department-0", `department-${1 + (i % 99)}`],
    position: "",
    email: "",
    wecomUserId: "",
    userId: i < members.length ? members[i].id : null,
    active: i % 50 !== 0,
    source: "manual",
  })),
});
const tasks = [];
for (const [i, project] of projects.entries()) {
  const root = `people-parent-${i}`,
    nested = `people-nested-${i}`;
  for (const [id, parentId] of [
    [root, null],
    [nested, root],
  ])
    tasks.push({
      ...base,
      id,
      parentId,
      projectId: project.id,
      title: id,
      assignee: "",
      assigneeId: null,
      workWeek: null,
      workDates: [],
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      dependencies: [],
    });
  for (let j = 0; j < 25; j++) {
    const n = i * 25 + j,
      member = members[n % members.length];
    const date = `2026-10-${19 + (n % 7)}`;
    tasks.push({
      ...base,
      id: `people-task-${n}`,
      projectId: project.id,
      parentId: j < 12 ? root : nested,
      title: `Synthetic task ${n}`,
      status: ["todo", "in_progress", "blocked", "done"][n % 4],
      assigneeId: n % 10 < 8 ? member.id : null,
      assignee:
        n % 10 < 8 ? member.name : n % 10 === 8 ? `Text owner ${n % 20}` : "",
      workWeek: n % 5 ? "2026-10-19" : null,
      workDates: n % 5 > 1 ? [date] : [],
      dueDate: n % 3 ? "2026-10-23" : "2026-10-16",
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      dependencies: [],
    });
  }
  if (i < 100)
    tasks.push({
      ...base,
      id: `people-void-${i}`,
      projectId: project.id,
      parentId: root,
      title: "Synthetic voided task",
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      dependencies: [],
      voided: {
        at: "2026-10-17T00:00:00Z",
        actor: "Synthetic",
        actorId: "synthetic",
        reason: "Benchmark",
        batchId: `people-batch-${i}`,
      },
    });
}
validateGraph(projects, tasks);
const snapshot = { tasks, members, directory };
const query = {
  scope: "all",
  status: "",
  project: "",
  query: "",
  focus: "all",
};
const context = {
  now: new Date("2026-10-19T00:00:00Z"),
  timeZone: "Asia/Shanghai",
  actorId: members[1].id,
};
const run = (filters = {}, patch = {}) =>
  projectPeopleWork(snapshot, { ...query, ...patch }, filters, context);
const all = run({ showAll: true });
assert.equal(all.tasks.length, 5000);
assert.equal(new Set(all.tasks.map((task) => task.id)).size, 5000);
assert.equal(all.counts.total, 5000);
const cases = {
  enterAllEmployees: () => run({ showAll: true }),
  peopleWithWork: () => run(),
  narrowDepartment: () => run({ department: "department-1", showAll: true }),
  searchEmployeeNumber: () => run({ search: "E01234", showAll: true }),
  narrowProject: () => run({ showAll: true }, { project: projects[0].id }),
  selectPerson: () => run({ person: `member:${members[1].id}` }),
  restoreAll: () => run({ showAll: true }),
};
assert.equal(cases.narrowProject().counts.total, 25);
assert.equal(cases.selectPerson().counts.total, 2);
assert.equal(cases.searchEmployeeNumber().groups.length, 1);
const results = {};
for (const [name, measure] of Object.entries(cases)) {
  for (let i = 0; i < 5; i++) measure();
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const result = measure();
    samples.push(performance.now() - start);
    assert.equal(result.counts.total, result.tasks.length);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results[name] = {
    warmup: 5,
    n: samples.length,
    p50: sorted[14],
    p95: sorted[28],
    max: sorted[29],
    samples,
  };
}
const report = {
  scope:
    "Node domain computation only; excludes browser DOM, navigation, network and polling. Does not satisfy the MV044 browser gate.",
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpu: cpus()[0]?.model,
    totalMemoryBytes: totalmem(),
  },
  dataset: {
    projects: projects.length,
    activeLeaves: 5000,
    parents: 400,
    voidedLeaves: 100,
    storedTasks: tasks.length,
    employees: directory.employees.length,
    members: members.length,
    departments: directory.departments.length,
    visibleGroups: all.groups.length,
  },
  results,
};
mkdirSync("docs/evidence", { recursive: true });
const output = `docs/evidence/people-domain-baseline-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      summary: Object.fromEntries(
        Object.entries(results).map(([name, value]) => [
          name,
          { p50: value.p50, p95: value.p95, max: value.max },
        ]),
      ),
    },
    null,
    2,
  ),
);
