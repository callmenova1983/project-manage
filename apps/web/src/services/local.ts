import {
  defaultWorkspaceSettings,
  workspaceSettingsInput,
} from "../../../../packages/domain/time-zone";
import {
  defaultCatalogs,
  defaultModelSettings,
  catalogsInput,
  adminUserInput,
  adminUserUpdate,
  modelSettingsInput,
  checkCatalogs,
  checkProjectCatalog,
  importCatalogs,
  validateCatalogReferences,
  type ManagedUser,
  type ModelSettings,
  type ModelLog,
  type AdminAudit,
} from "../../../../packages/domain/admin";
import { createSeed } from "../../../../packages/domain/seed";
import {
  projectMembers,
  taskMember,
} from "../../../../packages/domain/members";
import {
  queryActivities,
  compareActivities,
} from "../../../../packages/domain/activity-query";
import {
  intakeInput,
  planIntake,
  verifyIntakeUndo,
  intakeProvenance,
  type IntakeBatch,
} from "../../../../packages/domain/intake";
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
  role: "admin",
};
export function createLocalApi(): WorkspaceApi {
  let state: Snapshot & {
    intakes?: IntakeBatch[];
    administration?: {
      users: ManagedUser[];
      model: ModelSettings;
      logs: ModelLog[];
      audit: AdminAudit[];
    };
  };
  const proposals = new Map<string, Proposal>();
  const read = () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      state = {
        ...createSeed(),
        schemaVersion: 2,
        catalogs: structuredClone(defaultCatalogs),
      };
      localStorage.setItem(KEY, JSON.stringify(state));
    } else {
      try {
        const data = JSON.parse(raw);
        const parsed = snapshotImport.parse(data);
        validateGraph(parsed.projects, parsed.tasks);
        if (parsed.schemaVersion === 2 && !parsed.catalogs)
          throw new Error("Missing catalog");
        validateCatalogReferences(
          parsed.projects,
          parsed.catalogs ?? defaultCatalogs,
        );
        state = {
          ...data,
          ...parsed,
          schemaVersion: 2,
          catalogs: parsed.catalogs ?? structuredClone(defaultCatalogs),
        };
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
        kind === "task"
          ? ((after as Task)?.projectId ?? (before as Task)?.projectId ?? null)
          : (after?.id ?? before?.id ?? null),
      entityId: after?.id ?? before?.id ?? "",
      kind,
      action: action ?? (before ? "Updated " + kind : "Created " + kind),
      actor: actor.name,
      actorId: actor.id,
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
    checkProjectCatalog(
      data,
      state.catalogs ?? defaultCatalogs,
      id ? state.projects.find((p) => p.id === id) : undefined,
    );
    const old = state.projects.find((p) => p.id === id);
    if (id && !old) throw new ApiError("Project not found", 404);
    if (old && old.version !== version)
      throw new ApiError(
        "This project changed in another tab. Review the latest version.",
        409,
        old,
      );
    const p: Project = {
      ...projectMembers(data, administration().users, old),
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
    if (
      old &&
      data.projectId !== old.projectId &&
      (old.parentId ||
        data.parentId ||
        state.tasks.some((x) => x.parentId === old.id))
    )
      throw new ApiError("Only standalone tasks can change project assignment");
    const t: Task = {
      ...taskMember(data, administration().users, old),
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
  function administration() {
    if (!state.administration)
      state.administration = {
        users: [
          {
            id: actor.id,
            name: actor.name,
            email: actor.email,
            role: "admin",
            status: "active",
            version: 1,
            activationRequired: false,
          },
          {
            id: "demo-member",
            name: "Jamie Chen",
            email: "jamie@example.test",
            role: "member",
            status: "active",
            version: 1,
            activationRequired: false,
          },
        ],
        model: { ...defaultModelSettings },
        logs: [
          {
            id: "simulation-example",
            createdAt: new Date().toISOString(),
            actor: "Local demo",
            provider: "qwen",
            model: "qwen3.6-35b-a3b",
            mode: "simulated",
            status: "succeeded",
            durationMs: 420,
            inputTokens: 180,
            outputTokens: 64,
            cost: null,
            errorCode: null,
            attempts: 1,
          },
        ],
        audit: [],
      };
    return state.administration;
  }
  function auditAdmin(action: string, target: string) {
    administration().audit.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actor: actor.name,
      action,
      target,
    });
  }
  function historyPage(
    query: import("../../../../packages/domain/activity-query").ActivityQuery,
    exportAll = false,
  ) {
    const timeZone = (state.settings ?? defaultWorkspaceSettings).timeZone;
    if (query.timeZone && query.timeZone !== timeZone)
      throw new ApiError(
        "Workspace time zone changed. Refresh history before continuing.",
        409,
      );
    const through =
      query.cursor?.through ??
      query.checkpoint?.through ??
      state.activities.length;
    const events = through
      ? state.activities.slice(-through).sort(compareActivities)
      : [];
    return queryActivities(
      events,
      { ...query, timeZone },
      through,
      new Date(),
      exportAll,
    );
  }
  function modelState() {
    return {
      settings: structuredClone(administration().model),
      credentialAvailable: false,
      runtimeEnabled: false,
      approvedRegion: null,
      approvedModel: null,
      remainingAttempts: 0,
      expiresAt: null,
    };
  }
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
      const snapshot = read();
      return {
        ...snapshot,
        settings: state.settings ?? { ...defaultWorkspaceSettings },
        members: administration().users.map(({ id, name, email, status }) => ({
          id,
          name,
          email,
          status,
        })),
      };
    },
    async saveWorkspaceSettings(input) {
      read();
      const old = state.settings ?? defaultWorkspaceSettings;
      if (!input.confirmed)
        throw new ApiError("Confirm changing the workspace time zone");
      const parsed = workspaceSettingsInput.parse({
        timeZone: input.timeZone,
        version: input.version,
      });
      if (old.version !== parsed.version)
        throw new ApiError(
          "Workspace settings changed. Reload the current settings before saving.",
          409,
        );
      state.settings = { timeZone: parsed.timeZone, version: old.version + 1 };
      auditAdmin(
        `Changed workspace time zone: ${old.timeZone} → ${parsed.timeZone}`,
        actor.workspaceId,
      );
      persist();
      return structuredClone(state.settings);
    },
    async activityPage(query) {
      read();
      return historyPage(query);
    },
    async exportActivity(query) {
      read();
      return historyPage(query, true);
    },
    async activity(id) {
      read();
      const event = state.activities.find((a) => a.id === id);
      if (!event) throw new ApiError("History record not found", 404);
      return structuredClone(event);
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
        ...taskMember(taskInput.parse(data), administration().users),
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
      const result = read();
      return {
        ...result,
        settings: state.settings ?? { ...defaultWorkspaceSettings },
      };
    },
    async importData(data, revision) {
      read();
      if (state.revision !== revision)
        throw new ApiError("Workspace changed. Review again.", 409);
      const parsed = snapshotImport.parse(data);
      parsed.projects = parsed.projects.map((p) =>
        projectMembers(
          p,
          administration().users,
          state.projects.find((old) => old.id === p.id),
        ),
      );
      parsed.tasks = parsed.tasks.map((t) =>
        taskMember(
          t,
          administration().users,
          state.tasks.find((old) => old.id === t.id),
        ),
      );
      validateGraph(parsed.projects, parsed.tasks);
      const catalogs = importCatalogs(
        parsed,
        state.catalogs ?? defaultCatalogs,
        true,
      );
      state = {
        ...parsed,
        settings: state.settings ?? { ...defaultWorkspaceSettings },
        schemaVersion: 2,
        catalogs,
        revision: state.revision,
        activities: state.activities,
        administration: state.administration,
        intakes: state.intakes,
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
    async adminUsers() {
      read();
      return structuredClone(administration().users);
    },
    async saveUser(input, id) {
      read();
      const admin = administration();
      if (id) {
        const parsed = adminUserUpdate.parse(input),
          old = admin.users.find((u) => u.id === id);
        if (!old) throw new ApiError("User not found", 404);
        if (old.version !== parsed.version)
          throw new ApiError("This user changed. Reload before saving.", 409);
        if (admin.users.some((u) => u.id !== id && u.email === parsed.email))
          throw new ApiError("This email is already in use");
        if (old.activationRequired && parsed.status === "active")
          throw new ApiError(
            "A pending user must activate their account first",
          );
        if (!old.activationRequired && parsed.status === "pending")
          throw new ApiError("Active accounts cannot be returned to pending");
        if (
          old.role === "admin" &&
          old.status === "active" &&
          (parsed.role !== "admin" || parsed.status !== "active") &&
          admin.users.filter((u) => u.role === "admin" && u.status === "active")
            .length === 1
        )
          throw new ApiError("Keep at least one active administrator");
        const updated = { ...old, ...parsed, version: old.version + 1 };
        admin.users = admin.users.map((u) => (u.id === id ? updated : u));
        auditAdmin("Updated user access", id);
        persist();
        return structuredClone(updated);
      }
      const parsed = adminUserInput.parse(input);
      if (admin.users.some((u) => u.email === parsed.email))
        throw new ApiError("This email cannot be used for a new account");
      const created: ManagedUser = {
        ...parsed,
        id: crypto.randomUUID(),
        status: "pending",
        version: 1,
        activationRequired: true,
      };
      admin.users.push(created);
      auditAdmin("Created pending user", created.id);
      persist();
      return structuredClone(created);
    },
    async userActivation(id) {
      read();
      const user = administration().users.find((u) => u.id === id);
      if (!user || user.status !== "pending")
        throw new ApiError("Activation links are only for pending accounts");
      user.status = "active";
      user.activationRequired = false;
      user.version++;
      auditAdmin("Simulated account activation", id);
      persist();
      return {
        token: null,
        expiresAt: new Date().toISOString(),
        simulated: true,
      };
    },
    async activateAccount() {
      throw new ApiError("Demo accounts do not authenticate to the server");
    },
    async catalogs() {
      read();
      return structuredClone(state.catalogs ?? defaultCatalogs);
    },
    async saveCatalogs(input) {
      read();
      const old = state.catalogs ?? defaultCatalogs,
        next = catalogsInput.parse(input);
      if (next.version !== old.version)
        throw new ApiError("Catalog changed. Reload before saving.", 409);
      checkCatalogs(next, old, state.projects);
      next.version++;
      state.catalogs = next;
      auditAdmin("Updated stage and category catalog", actor.workspaceId);
      persist();
      return structuredClone(next);
    },
    async modelAdmin() {
      read();
      return modelState();
    },
    async saveModel(input) {
      read();
      const next = modelSettingsInput.parse(input),
        admin = administration();
      if (next.version !== admin.model.version)
        throw new ApiError(
          "Model settings changed. Reload before saving.",
          409,
        );
      if (next.enabled)
        throw new ApiError(
          "Provision matching server credentials before enabling calls",
        );
      next.version++;
      admin.model = next;
      auditAdmin("Updated model settings", actor.workspaceId);
      persist();
      return modelState();
    },
    async modelLogs() {
      read();
      return structuredClone(administration().logs);
    },
    async adminAudit() {
      read();
      return structuredClone(administration().audit);
    },
    async intakeHistory() {
      read();
      return structuredClone(state.intakes ?? []);
    },
    async applyIntake(input) {
      read();
      const batch = planIntake(
        intakeInput.parse(input),
        state,
        actor.name,
        () => crypto.randomUUID(),
      );
      for (const project of batch.projects)
        checkProjectCatalog(project, state.catalogs ?? defaultCatalogs);
      for (const p of batch.projects)
        Object.assign(p, projectMembers(p, administration().users));
      for (const t of batch.tasks)
        Object.assign(t, taskMember(t, administration().users));
      state.projects.push(...batch.projects);
      state.tasks.push(...batch.tasks);
      validateGraph(state.projects, state.tasks);
      for (const p of batch.projects)
        record(
          "project",
          null,
          p,
          intakeProvenance(batch, p.id),
          "Created project from intake",
        );
      for (const task of batch.tasks)
        record(
          "task",
          null,
          task,
          intakeProvenance(batch, task.id),
          "Created task from intake",
        );
      state.intakes = [batch, ...(state.intakes ?? [])].slice(0, 30);
      persist();
      return structuredClone(batch);
    },
    async undoIntake(id) {
      read();
      const batch = state.intakes?.find((b) => b.id === id);
      if (!batch) throw new ApiError("Intake not found");
      verifyIntakeUndo(batch, state);
      state.projects = state.projects.filter(
        (p) => !batch.projects.some((x) => x.id === p.id),
      );
      state.tasks = state.tasks.filter(
        (t) => !batch.tasks.some((x) => x.id === t.id),
      );
      for (const p of batch.projects)
        record("project", p, null, `Intake undo · ${batch.id}`, "Undid intake");
      for (const task of batch.tasks)
        record("task", task, null, `Intake undo · ${batch.id}`, "Undid intake");
      batch.state = "undone";
      batch.undoneAt = new Date().toISOString();
      persist();
      return structuredClone(batch);
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
