import { createSeed } from "../../../../packages/domain/seed";
import {
  noteDateInput,
  noteDateCandidates,
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
        const parsed = snapshotImport.parse(data);
        validateGraph(parsed.projects, parsed.tasks);
        state = { ...data, ...parsed };
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
    action?: string,
  ) =>
    state.activities.unshift({
      id: crypto.randomUUID(),
      projectId:
        kind === "task" ? (after as Task)?.projectId : (after?.id ?? null),
      entityId: after?.id ?? "",
      kind,
      action: action ?? (before ? "Updated " + kind : "Created " + kind),
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
    source = "Local edit",
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
      reportedAt:
        data.latestUpdate === old?.latestUpdate
          ? old.reportedAt
          : data.latestUpdate.trim()
            ? new Date().toISOString()
            : null,
      reportedBy:
        data.latestUpdate === old?.latestUpdate
          ? old.reportedBy
          : data.latestUpdate.trim()
            ? actor.name
            : null,
      id: id ?? crypto.randomUUID(),
      version: (old?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    state.projects = old
      ? state.projects.map((x) => (x.id === id ? p : x))
      : [p, ...state.projects];
    record(
      "project",
      old ?? null,
      p,
      source,
      source === "History restore" ? "Restored previous version" : undefined,
    );
    persist();
    return p;
  };
  const saveTask = async (
    data: TaskInput,
    id?: string,
    version?: number,
    source = "Local edit",
  ) => {
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
    record(
      "task",
      old ?? null,
      t,
      source,
      source === "History restore" ? "Restored previous version" : undefined,
    );
    persist();
    return t;
  };
  return {
    async aiCapabilities() {
      return {
        enabled: false,
        provider: "rules",
        model: null,
        region: null,
        connectionVerified: false,
        remainingAttempts: 0,
      };
    },
    async proposeQwen() {
      throw new ApiError(
        "Qwen is unavailable in the browser-only demo. No notes were sent.",
        503,
      );
    },
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
    async confirmNoteDate(projectId, data) {
      read();
      const input = noteDateInput.parse(data);
      const p = state.projects.find((p) => p.id === projectId);
      const old = state.tasks.find((t) => t.id === input.taskId);
      if (!p || !old || old.projectId !== p.id)
        throw new ApiError("Choose a task in this project");
      if (
        p.version !== input.projectVersion ||
        old.version !== input.taskVersion
      )
        throw new ApiError("Notes or task changed. Review again.", 409);
      const candidate = noteDateCandidates(p.notes).find(
        (n) => n.sourceLine === input.sourceLine,
      );
      if (!candidate)
        throw new ApiError("Date source no longer matches saved notes");
      if (
        old.dueDate &&
        old.dueDate !== input.dueDate &&
        !input.overwriteConfirmed
      )
        throw new ApiError("Confirm replacing the existing due date");
      const next = {
        ...old,
        dueDate: input.dueDate,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      state.tasks = state.tasks.map((t) => (t.id === old.id ? next : t));
      record(
        "task",
        old,
        next,
        `Project notes ${p.id} v${p.version}, line ${candidate.sourceLine}: ${candidate.context}`,
      );
      persist();
      return next;
    },
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
      const updates = new Map<
        string,
        { before: Project; titles: string[]; sources: string[] }
      >();
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
            const group = updates.get(p.id) ?? {
              before: p,
              titles: [],
              sources: [],
            };
            group.titles.push(s.title);
            group.sources.push(
              `Meeting source ${original.id} v1, line ${source.sourceLine}: ${source.sourceText}`,
            );
            updates.set(p.id, group);
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
        for (const group of updates.values()) {
          const next = {
            ...group.before,
            latestUpdate: group.titles.join("\n"),
            version: group.before.version + 1,
            updatedAt: new Date().toISOString(),
            reportedAt: new Date().toISOString(),
            reportedBy: actor.name,
          };
          projectInput.strip().parse(next);
          state.projects = state.projects.map((p) =>
            p.id === next.id ? next : p,
          );
          record("project", group.before, next, group.sources.join("\n"));
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
        ? saveProject(
            projectInput.strip().parse(a.before),
            a.entityId,
            version,
            "History restore",
          )
        : saveTask(
            taskInput.strip().parse(a.before),
            a.entityId,
            version,
            "History restore",
          );
    },
  };
}
