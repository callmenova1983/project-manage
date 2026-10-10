import { createSeed } from "../../../../packages/domain/seed";
import {
  projectInput,
  taskInput,
  snapshotImport,
  validateGraph,
  suggest,
  type Snapshot,
  type Actor,
  type Project,
  type Task,
  type ProjectInput,
  type TaskInput,
  type Proposal,
  type Activity,
} from "../../../../packages/domain/types";
import {
  ApiError,
  type WorkspaceApi,
  type ReviewedSuggestion,
} from "./contracts";
const KEY = "project-manage-demo-v1";
const actor: Actor = {
  id: "local-demo",
  workspaceId: "local-demo",
  email: "demo@example.test",
  name: "Local demo",
};
export function createLocalApi(): WorkspaceApi {
  let state: Snapshot;
  const proposals = new Map<string, Proposal>();
  const read = () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      state = createSeed();
      localStorage.setItem(KEY, JSON.stringify(state));
    } else {
      try {
        const data = JSON.parse(raw);
        snapshotImport.parse(data);
        validateGraph(data.projects, data.tasks);
        state = data;
      } catch {
        throw new ApiError(
          "Local demo data is invalid. Export your browser storage before resetting this demo.",
        );
      }
    }
    return structuredClone(state);
  };
  const persist = () => {
    state.revision++;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      throw new ApiError(
        "Browser storage is full or unavailable. Export your work and free some space.",
      );
    }
  };
  const record = (
    kind: Activity["kind"],
    before: Project | Task | null,
    after: Project | Task | null,
    source = "Local edit",
  ) =>
    state.activities.unshift({
      id: crypto.randomUUID(),
      projectId:
        kind === "task" ? (after as Task)?.projectId : (after?.id ?? null),
      entityId: after?.id ?? "",
      kind,
      action: before ? "Updated " + kind : "Created " + kind,
      actor: actor.name,
      createdAt: new Date().toISOString(),
      source,
      before,
      after,
    });
  const saveProject = async (
    data: ProjectInput,
    id?: string,
    version?: number,
  ) => {
    read();
    projectInput.parse(data);
    const old = state.projects.find((p) => p.id === id);
    if (id && !old) throw new ApiError("Project not found", 404);
    if (old && old.version !== version)
      throw new ApiError(
        "This project changed in another tab. Review the latest version.",
        409,
        old,
      );
    const p: Project = {
      ...data,
      id: id ?? crypto.randomUUID(),
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    state.projects = old
      ? state.projects.map((x) => (x.id === id ? p : x))
      : [p, ...state.projects];
    record("project", old ?? null, p);
    persist();
    return p;
  };
  const saveTask = async (data: TaskInput, id?: string, version?: number) => {
    read();
    taskInput.parse(data);
    const old = state.tasks.find((t) => t.id === id);
    if (id && !old) throw new ApiError("Task not found", 404);
    if (old && old.version !== version)
      throw new ApiError("This task changed in another tab.", 409, old);
    if (
      old &&
      state.tasks.some((x) => x.parentId === old.id) &&
      old.status !== data.status
    )
      throw new ApiError("Update the subtasks individually");
    const t: Task = {
      ...data,
      id: id ?? crypto.randomUUID(),
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    state.tasks = old
      ? state.tasks.map((x) => (x.id === id ? t : x))
      : [...state.tasks, t];
    validateGraph(state.projects, state.tasks);
    record("task", old ?? null, t);
    persist();
    return t;
  };
  return {
    mode: "local",
    async session() {
      return { actor };
    },
    async login() {
      return { actor };
    },
    async logout() {},
    async snapshot() {
      return read();
    },
    saveProject,
    saveTask,
    async addTasks(tasks) {
      read();
      const result = tasks.map((data) => ({
        ...taskInput.parse(data),
        id: crypto.randomUUID(),
        version: 1,
        updatedAt: new Date().toISOString(),
      }));
      state.tasks.push(...result);
      validateGraph(state.projects, state.tasks);
      result.forEach((t) => record("task", null, t, "Text / TSV paste"));
      persist();
      return result;
    },
    async exportData() {
      return read();
    },
    async importData(data, revision) {
      read();
      if (state.revision !== revision)
        throw new ApiError("Workspace changed. Review again.", 409);
      const parsed = snapshotImport.parse(data);
      validateGraph(parsed.projects, parsed.tasks);
      state = {
        ...parsed,
        revision: state.revision,
        activities: state.activities,
      };
      persist();
      return read();
    },
    async propose(source) {
      read();
      const p: Proposal = {
        id: crypto.randomUUID(),
        source,
        sourceVersion: 1,
        status: "draft",
        createdAt: new Date().toISOString(),
        suggestions: suggest(source, state.projects),
      };
      proposals.set(p.id, p);
      return structuredClone(p);
    },
    async applyProposal(proposal, suggestions: ReviewedSuggestion[]) {
      read();
      const original = proposals.get(proposal.id);
      if (!original || original.status === "applied")
        throw new ApiError("Proposal is missing or already applied", 409);
      const copy = structuredClone(state);
      try {
        for (const s of suggestions) {
          const source = original.suggestions.find((x) => x.id === s.id);
          if (!source || !s.confirmed)
            throw new ApiError("Confirm every selected suggestion");
          const p = state.projects.find((x) => x.id === s.selectedProjectId);
          if (!p) throw new ApiError("Choose a project");
          if (s.action === "update") {
            if (!s.overwriteConfirmed || p.version !== s.projectVersion)
              throw new ApiError(
                "Review and confirm the latest update",
                409,
                p,
              );
            const next = {
              ...p,
              latestUpdate: s.title,
              version: p.version + 1,
            };
            state.projects = state.projects.map((x) =>
              x.id === p.id ? next : x,
            );
            record("project", p, next, source.sourceText);
          } else {
            const t: Task = {
              ...taskInput.parse({
                projectId: p.id,
                parentId: null,
                title: s.title,
                description: source.sourceText,
                status: s.status,
                assignee: "Unassigned",
                dueDate: null,
                workWeek: null,
                workDates: [],
              }),
              id: crypto.randomUUID(),
              version: 1,
              updatedAt: new Date().toISOString(),
            };
            state.tasks.push(t);
            record("task", null, t, source.sourceText);
          }
        }
        persist();
        original.status = "applied";
        return structuredClone(original);
      } catch (e) {
        state = copy;
        throw e;
      }
    },
    async restore(id, version) {
      read();
      const a = state.activities.find((x) => x.id === id);
      if (!a?.before) throw new ApiError("No restorable version");
      return a.kind === "project"
        ? saveProject(projectInput.strip().parse(a.before), a.entityId, version)
        : saveTask(taskInput.strip().parse(a.before), a.entityId, version);
    },
  };
}
