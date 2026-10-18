import type { CompanyDirectory, Employee } from "./directory.js";
import { weekBounds } from "./time-zone.js";
import {
  createTaskViewIndex,
  taskAssigneeKey,
  taskIsOverdue,
  taskIsUnplanned,
  type TaskViewContext,
  type TaskViewQuery,
} from "./task-view.js";
import type { Member, Snapshot, Task } from "./types.js";

export interface PeopleWorkFilter {
  department?: string;
  person?: string;
  search?: string;
  showAll?: boolean;
}
export interface PersonWorkGroup {
  key: string;
  kind: "member" | "employee" | "text" | "unassigned";
  name: string;
  member?: Member;
  employee?: Employee;
  departmentIds: string[];
  departments: string[];
  canAssign: boolean;
  tasks: Task[];
  counts: {
    total: number;
    open: number;
    done: number;
    blocked: number;
    overdue: number;
    unplanned: number;
  };
  days: Record<string, Task[]>;
  undatedWeeks: { week: string; tasks: Task[] }[];
  unscheduled: Task[];
}

/** An employee can belong to several departments; membership never duplicates work. */
export function departmentTreeIds(
  directory: CompanyDirectory | undefined,
  id: string,
): Set<string> {
  if (!directory?.departments.some((department) => department.id === id))
    return new Set();
  const result = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const department of directory.departments) {
      if (
        department.parentId &&
        result.has(department.parentId) &&
        !result.has(department.id)
      ) {
        result.add(department.id);
        changed = true;
      }
    }
  }
  return result;
}

/** Group the shared query's leaves by explicit account linkage, never by a guessed employee. */
export function projectPeopleWork(
  snapshot: Pick<Snapshot, "tasks" | "members" | "directory">,
  query: TaskViewQuery,
  filters: PeopleWorkFilter = {},
  context: TaskViewContext = {},
) {
  const index = createTaskViewIndex(snapshot.tasks, {
    ...context,
    members: snapshot.members,
  });
  const weekDates = weekBounds(index.week, context.timeZone ?? "UTC").days;
  const departments = new Map(
    (snapshot.directory?.departments ?? []).map((department) => [
      department.id,
      department.name,
    ]),
  );
  const employeesByUser = new Map(
    (snapshot.directory?.employees ?? [])
      .filter((employee) => employee.userId)
      .map((employee) => [employee.userId!, employee]),
  );
  const groups = new Map<string, PersonWorkGroup>();
  const make = (
    key: string,
    kind: PersonWorkGroup["kind"],
    name: string,
    member?: Member,
    employee?: Employee,
  ) => {
    const group: PersonWorkGroup = {
      key,
      kind,
      name,
      member,
      employee,
      departmentIds: employee?.departmentIds ?? [],
      departments: (employee?.departmentIds ?? []).map(
        (id) => departments.get(id) ?? id,
      ),
      canAssign: member?.status === "active",
      tasks: [],
      counts: {
        total: 0,
        open: 0,
        done: 0,
        blocked: 0,
        overdue: 0,
        unplanned: 0,
      },
      days: Object.fromEntries(weekDates.map((date) => [date, [] as Task[]])),
      undatedWeeks: [],
      unscheduled: [],
    };
    groups.set(key, group);
    return group;
  };
  for (const member of snapshot.members ?? [])
    make(
      `member:${member.id}`,
      "member",
      member.name,
      member,
      employeesByUser.get(member.id),
    );
  for (const employee of snapshot.directory?.employees ?? []) {
    if (!employee.userId || !groups.has(`member:${employee.userId}`))
      make(
        `employee:${employee.id}`,
        "employee",
        employee.name,
        undefined,
        employee,
      );
  }
  const undated = new Map<string, Map<string, Task[]>>();
  for (const task of index.select(query)) {
    const key = taskAssigneeKey(task);
    const group =
      groups.get(key) ??
      make(
        key,
        key.startsWith("member:")
          ? "member"
          : key === "none"
            ? "unassigned"
            : "text",
        task.assignee.trim() || "Member unavailable",
      );
    group.tasks.push(task);
    group.counts.total++;
    if (task.status === "done") group.counts.done++;
    else group.counts.open++;
    if (task.status === "blocked") group.counts.blocked++;
    if (taskIsOverdue(task, index.today)) group.counts.overdue++;
    if (taskIsUnplanned(task)) group.counts.unplanned++;
    for (const date of new Set(task.workDates)) group.days[date]?.push(task);
    if (task.workWeek && !task.workDates.length) {
      const weeks = undated.get(key) ?? new Map<string, Task[]>();
      const rows = weeks.get(task.workWeek) ?? [];
      rows.push(task);
      weeks.set(task.workWeek, rows);
      undated.set(key, weeks);
    }
    if (!task.workWeek && !task.workDates.length) group.unscheduled.push(task);
  }
  for (const [key, weeks] of undated)
    groups.get(key)!.undatedWeeks = [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, tasks]) => ({ week, tasks }));
  const departmentIds = filters.department
    ? departmentTreeIds(snapshot.directory, filters.department)
    : null;
  const search = filters.search?.trim().toLocaleLowerCase();
  const rows = [...groups.values()]
    .filter((group) => {
      if (
        !group.tasks.length &&
        (!filters.showAll ||
          !(group.employee
            ? group.employee.active
            : group.member?.status === "active"))
      )
        return false;
      if (filters.person && group.key !== filters.person) return false;
      if (
        departmentIds &&
        !group.departmentIds.some((id) => departmentIds.has(id))
      )
        return false;
      return (
        !search ||
        `${group.name} ${group.member?.email ?? ""} ${group.employee?.employeeNo ?? ""} ${group.departments.join(" ")}`
          .toLocaleLowerCase()
          .includes(search)
      );
    })
    .sort(
      (a, b) =>
        b.counts.open - a.counts.open ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key),
    );
  return {
    groups: rows,
    today: index.today,
    week: index.week,
    weekDates,
    tasks: rows.flatMap((group) => group.tasks),
    counts: rows.reduce(
      (total, group) => ({
        total: total.total + group.counts.total,
        open: total.open + group.counts.open,
        done: total.done + group.counts.done,
        blocked: total.blocked + group.counts.blocked,
        overdue: total.overdue + group.counts.overdue,
        unplanned: total.unplanned + group.counts.unplanned,
      }),
      { total: 0, open: 0, done: 0, blocked: 0, overdue: 0, unplanned: 0 },
    ),
  };
}
