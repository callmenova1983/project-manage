import { createSeed } from "../../packages/domain/seed";
import { defaultCatalogs } from "../../packages/domain/admin";
import { emptyDirectory, type Employee } from "../../packages/domain/directory";
import {
  validateGraph,
  type Task,
  type Snapshot,
} from "../../packages/domain/types";
export const multiViewContext = {
  now: new Date("2026-10-18T16:05:00Z"),
  timeZone: "Asia/Shanghai",
  actorId: "member-a",
};
export function multiViewFixture(): Snapshot {
  const projects = createSeed(multiViewContext.now)
    .projects.slice(0, 2)
    .map((project, index) => ({
      ...project,
      id: `p${index + 1}`,
      name: `Synthetic project ${index + 1}`,
    }));
  const task = (id: string, patch: Partial<Task> = {}): Task => ({
    id,
    title: `Leaf ${id}`,
    projectId: "p1",
    parentId: null,
    description: "Synthetic multi-view fixture",
    status: "todo",
    assignee: "",
    assigneeId: null,
    dueDate: null,
    workWeek: null,
    workDates: [],
    version: 1,
    updatedAt: "2026-10-18T12:00:00Z",
    ...patch,
  });
  const voided = {
    at: "2026-10-18T12:00:00Z",
    actor: "Synthetic",
    actorId: "synthetic",
    reason: "Fixture void",
    batchId: "synthetic-void",
  };
  const tasks = [
    task("root", { title: "Parent root" }),
    task("nested", { title: "Parent nested", parentId: "root" }),
    task("a", {
      parentId: "nested",
      status: "in_progress",
      assignee: "旧保存姓名",
      assigneeId: "member-a",
      dueDate: "2026-10-18",
      workWeek: "2026-10-19",
      workDates: ["2026-10-19", "2026-10-21"],
      estimatedDate: "2026-10-21",
      reminderAt: "2026-10-18T16:15:00Z",
      scheduleStart: "2026-10-20",
      scheduleEnd: "2026-10-22",
      dependencies: [{ taskId: "b", type: "finish_to_start" }],
    }),
    task("b", {
      assignee: "王敏",
      assigneeId: "member-b",
      workWeek: "2026-10-19",
      scheduleStart: "2026-10-18",
      scheduleEnd: "2026-10-18",
      milestone: true,
    }),
    task("c", {
      parentId: "root",
      status: "done",
      assignee: "王敏",
      workWeek: "2026-10-19",
      workDates: ["2026-10-19"],
      dueDate: "2026-10-20",
    }),
    task("d", {
      projectId: "p2",
      status: "blocked",
      dueDate: "2026-10-19",
      estimatedDate: "2026-10-23",
      reminderAt: "2026-10-19T15:59:00Z",
      scheduleStart: "2026-11-05",
      scheduleEnd: "2026-11-06",
    }),
    task("e", {
      status: "blocked",
      assignee: "其他",
      workWeek: "2026-10-12",
      dueDate: "2026-10-01",
    }),
    task("v", {
      parentId: "root",
      assigneeId: "member-a",
      assignee: "王敏",
      voided,
      workWeek: "2026-10-19",
      workDates: ["2026-10-19"],
    }),
    task("void-parent", {
      projectId: "p2",
      title: "Parent with only voided children",
    }),
    task("v2", { projectId: "p2", parentId: "void-parent", voided }),
  ];
  const employee = (id: string, userId: string | null): Employee => ({
    id,
    name: "王敏",
    employeeNo: id,
    active: true,
    userId,
    email: "",
    wecomUserId: "",
    position: "",
    departmentIds: ["root-dep", "child-dep"],
    source: "manual",
  });
  validateGraph(projects, tasks);
  return {
    schemaVersion: 3,
    catalogs: structuredClone(defaultCatalogs),
    settings: { version: 1, timeZone: multiViewContext.timeZone },
    revision: 1,
    projects,
    tasks,
    activities: [],
    members: [
      {
        id: "member-a",
        name: "王敏",
        email: "a@example.test",
        status: "active",
      },
      {
        id: "member-b",
        name: "王敏",
        email: "b@example.test",
        status: "disabled",
      },
    ],
    directory: {
      ...emptyDirectory(),
      departments: [
        { id: "root-dep", name: "Root", parentId: null, wecomId: null },
        { id: "child-dep", name: "Child", parentId: "root-dep", wecomId: null },
      ],
      employees: [
        employee("employee-a", "member-a"),
        employee("employee-b", "member-b"),
        employee("unlinked-employee", null),
      ],
    },
  };
}
