import {
  dayKey,
  weekKey,
  statistics,
  type Project,
  type Task,
  type Snapshot,
  type Status,
  stages,
  disciplines,
} from "./types.js";
const names = [
  "Atlas Customer Portal",
  "Meridian Workspace",
  "Northstar Analytics",
  "Evergreen Commerce",
  "Orbit Mobile App",
  "Harbor Design System",
  "Solstice Booking",
  "Juniper CRM",
  "Cobalt Data Platform",
  "Summit Website",
  "Willow Onboarding",
  "Aster Knowledge Hub",
  "Cedar Operations",
  "Nimbus Reporting",
  "Lumen Payments",
  "Mosaic Inventory",
  "Vertex Integration",
  "Acorn Support",
  "Tidal Insights",
  "Fern Member Portal",
];
const owners = [
  "Alex Morgan",
  "Jamie Chen",
  "Sam Rivera",
  "Taylor Kim",
  "Jordan Lee",
];
const titles = [
  "Confirm project scope",
  "Share discovery notes",
  "Review design direction",
  "Build core workflow",
  "Connect service integration",
  "Run acceptance checks",
  "Prepare release notes",
  "Collect team feedback",
];
export function createSeed(now = new Date()): Snapshot {
  const date = dayKey(now),
    week = weekKey(now),
    time = now.toISOString();
  const projects: Project[] = names.map((name, i) => ({
    id: `project-${i + 1}`,
    name,
    client: [
      "Acme Studio",
      "Meridian Labs",
      "Northstar Co.",
      "Evergreen Group",
      "Orbit Works",
    ][i % 5]!,
    description: `A collaborative ${name.toLowerCase()} initiative. All names and information in this workspace are fictional.`,
    stage: stages[i < 4 ? 3 : i < 8 ? 1 : i < 12 ? 2 : i < 16 ? 4 : 0]!,
    owner: owners[i % 5]!,
    discipline: disciplines[i % 4]!,
    latestUpdate: "",
    notes: "",
    aliases: [name.split(" ")[0]!],
    version: 1,
    updatedAt: new Date(now.getTime() - i * 900000).toISOString(),
  }));
  const tasks: Task[] = [];
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const count = i < 10 ? 8 : 7;
    const parentId = i < 10 ? `group-${i}` : null;
    if (parentId)
      tasks.push({
        id: parentId,
        projectId: projects[i]!.id,
        parentId: null,
        title: "Delivery checklist",
        description: "Group: completion is calculated from its children.",
        status: "todo",
        assignee: owners[i % 5]!,
        dueDate: null,
        workWeek: null,
        workDates: [],
        version: 1,
        updatedAt: time,
      });
    for (let j = 0; j < count; j++, n++) {
      let status: Status;
      if (n < 24)
        status =
          n < 4 ? "todo" : n < 12 ? "in_progress" : n < 22 ? "done" : "blocked";
      else
        status =
          n < 104
            ? "done"
            : n % 5 === 0
              ? "blocked"
              : n % 2 === 0
                ? "todo"
                : "in_progress";
      tasks.push({
        id: `task-${n + 1}`,
        projectId: projects[i]!.id,
        parentId: j < 3 ? parentId : null,
        title: titles[j]!,
        description: "Synthetic task for the demonstration workspace.",
        status,
        assignee: owners[(i + j) % 5]!,
        dueDate: dayKey(new Date(now.getTime() + (j - 2) * 86400000)),
        workWeek: n < 24 ? week : null,
        workDates: n < 8 ? [date] : [],
        version: 1,
        updatedAt: time,
      });
    }
  }
  for (const p of projects) {
    const count = statistics(tasks.filter((t) => t.projectId === p.id));
    p.latestUpdate =
      count.done === count.total
        ? "All delivery tasks completed. Release notes and handoff are ready."
        : count.done > 0
          ? `${count.done} tasks completed. ${count.blocked ? `${count.blocked} items need coordination.` : "The team is continuing the remaining work."}`
          : "Scope discussion recorded. The team is working through the delivery checklist.";
  }
  return {
    schemaVersion: 1,
    revision: 1,
    projects,
    tasks,
    activities: projects.map((p, i) => ({
      id: `seed-event-${i}`,
      projectId: p.id,
      entityId: p.id,
      kind: "project",
      action: "Reported an update",
      actor: p.owner,
      createdAt: new Date(now.getTime() - i * 3600000).toISOString(),
      source: "Synthetic demo seed",
      before: null,
      after: p,
    })),
  };
}
