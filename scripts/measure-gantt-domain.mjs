import { performance } from "node:perf_hooks";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { createSeed } from "../dist/server/packages/domain/seed.js";
import { validateGraph } from "../dist/server/packages/domain/types.js";
import * as gantt from "../dist/server/packages/domain/task-gantt.js";

const label = process.argv[2] === "final" ? "final" : "baseline";
const seed = createSeed(new Date("2026-10-17T00:00:00Z"));
const base = seed.tasks.find(
  (task) => !seed.tasks.some((child) => child.parentId === task.id),
);
const projects = Array.from({ length: 200 }, (_, i) => ({
  ...seed.projects[i % seed.projects.length],
  id: `scale-${i + 1}`,
  name: `Synthetic project ${String(i + 1).padStart(3, "0")}`,
}));
const tasks = [],
  ids = new Set(),
  collapsed = new Set();
for (const [i, project] of projects.entries()) {
  const root = `scale-parent-${i}`,
    nested = `scale-nested-${i}`;
  for (const [id, parentId] of [
    [root, null],
    [nested, root],
  ])
    tasks.push({
      ...base,
      id,
      projectId: project.id,
      parentId,
      title: id,
      status: "todo",
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      dependencies: [],
    });
  collapsed.add(root);
  for (let j = 0; j < 25; j++) {
    const id = `scale-task-${i + 1}-${j + 1}`,
      date = `2026-11-${String(j + 1).padStart(2, "0")}`;
    tasks.push({
      ...base,
      id,
      projectId: project.id,
      parentId: j < 12 ? root : nested,
      title: `Synthetic work ${i + 1}/${j + 1}`,
      status: j % 4 === 0 ? "blocked" : "todo",
      scheduleStart: j % 7 ? date : null,
      scheduleEnd: j % 7 ? date : null,
      milestone: j % 7 !== 0 && j % 3 === 0,
      dependencies: j
        ? [{ taskId: `scale-task-${i + 1}-${j}`, type: "finish_to_start" }]
        : [],
    });
    ids.add(id);
  }
  if (i < 100)
    tasks.push({
      ...base,
      id: `scale-void-${i}`,
      projectId: project.id,
      parentId: root,
      title: "Synthetic voided work",
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      dependencies: [],
      voided: {
        at: "2026-10-17T00:00:00Z",
        actor: "Synthetic",
        reason: "Benchmark fixture",
        actorId: "synthetic",
        batchId: `batch-${i}`,
      },
    });
}
validateGraph(projects, tasks);
const full = gantt.taskGanttRows(tasks, ids);
const narrow = new Set([...ids].filter((id) => id.startsWith("scale-task-1-")));
if (label === "final" && !gantt.visibleGanttRows)
  throw new Error("Build optimized sources before measuring final.");
const cases = {
  fullProjection: () => gantt.taskGanttRows(tasks, ids),
  collapseAll: () =>
    label === "final"
      ? gantt.visibleGanttRows(full.rows, collapsed)
      : gantt.taskGanttRows(tasks, ids, collapsed).rows,
  narrowToOneProject: () => gantt.taskGanttRows(tasks, narrow),
  restoreAll: () => gantt.taskGanttRows(tasks, ids),
};
const results = {};
for (const [name, run] of Object.entries(cases)) {
  for (let i = 0; i < 5; i++) run();
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results[name] = {
    n: 30,
    warmup: 5,
    p50: sorted[14],
    p95: sorted[28],
    max: sorted[29],
    samples,
  };
}
const report = {
  label,
  scope:
    "Node domain computation only; excludes browser rendering, navigation and network. Not an MV044 browser gate.",
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpu: cpus()[0]?.model,
    totalMemoryBytes: totalmem(),
  },
  dataset: {
    projects: 200,
    activeLeaves: 5000,
    parents: 400,
    voidedLeaves: 100,
    storedTasks: tasks.length,
    dependencyEdges: 4800,
  },
  results,
};
mkdirSync("docs/evidence", { recursive: true });
const output = `docs/evidence/gantt-domain-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
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
