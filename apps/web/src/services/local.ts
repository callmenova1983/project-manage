import type { TaskReview } from "../../../../packages/domain/task-review";
import {
  planTaskFieldCopy,
  TaskFieldCopyConflict,
} from "../../../../packages/domain/task-field-copy";
import {
  suggestedLoginName,
  availableLoginName,
} from "../../../../packages/domain/login-name";
import { loginNameSchema } from "../../../../packages/domain/login-name-schema";
import {
  progressInput,
  progressHistory,
} from "../../../../packages/domain/progress";
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
  directorySchema,
  emptyDirectory,
} from "../../../../packages/domain/directory";
import {
  checkProjectOrder,
  orderedProjectIds,
  projectOrderInput,
} from "../../../../packages/domain/project-order";
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
import {
  projectRenameInput,
  planProjectMerge,
  ProjectMergeConflict,
} from "../../../../packages/domain/project-merge";
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
    state.projectOrder = orderedProjectIds(state.projects, state.projectOrder);
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
    progressSource?: Activity["progressSource"],
  ) => {
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
      createdAt: new Date().toISOString(),
      source,
      progressSource,
      before,
      after,
    });
    const projectId =
      kind === "task"
        ? (after as Task | null)?.projectId
        : kind === "project"
          ? after?.id
          : undefined;
    if (projectId) {
      state.projectMembers ??= [];
      const member = state.projectMembers.find(
        (m) => m.projectId === projectId && m.userId === actor.id,
      );
      const time = new Date().toISOString();
      if (member) member.lastEditedAt = time;
      else
        state.projectMembers.push({
          projectId,
          userId: actor.id,
          name: actor.name,
          department: "",
          position: "",
          joinedAt: time,
          lastEditedAt: time,
        });
    }
  };
  const saveProject = async (
    data: ProjectInput,
    id?: string,
    version?: number,
    source = "Local edit",
  ) => {
    read();
    data = projectInput.parse({
      ...data,
      channelId:
        data.channelId ??
        state.projects.find((p) => p.id === id)?.channelId ??
        "company",
    });
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
    if (
      old &&
      data.projectId !== old.projectId &&
      (old.parentId ||
        data.parentId ||
        state.tasks.some((x) => x.parentId === old.id))
    )
      throw new ApiError("Only standalone tasks can change project assignment");
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
  function loginName(
    name: string,
    requested: string | undefined,
    exceptId = "",
  ) {
    const taken = (value: string) =>
      state.administration?.users.some(
        (u) => u.id !== exceptId && u.username?.toLowerCase() === value,
      ) ?? false;
    if (requested?.trim()) {
      const value = loginNameSchema.parse(requested);
      if (taken(value))
        throw new ApiError("This login name is already in use", 409);
      return value;
    }
    return availableLoginName(suggestedLoginName(name), taken);
  }
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
    for (const user of state.administration.users)
      if (!user.username)
        user.username = loginName(user.name, undefined, user.id);
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
  function modelState() {
    return {
      settings: structuredClone(administration().model),
      credentialAvailable: false,
      credentialEditable: false,
      runtimeEnabled: false,
      approvedRegion: null,
      approvedModel: null,
      remainingAttempts: 0,
      expiresAt: null,
    };
  }
  return {
    async copyTaskField(input) {
      read();
      let changes;
      try {
        changes = planTaskFieldCopy(state.tasks, input);
      } catch (e) {
        throw new ApiError(
          (e as Error).message,
          e instanceof TaskFieldCopyConflict ? 409 : 400,
        );
      }
      const updates = new Map(
        changes.map((change) => [change.after.id, change.after]),
      );
      state.tasks = state.tasks.map((task) => updates.get(task.id) ?? task);
      for (const { before, after } of changes)
        record(
          "task",
          before,
          after,
          "Task field copy",
          input.field === "assignee"
            ? "Copied task assignee"
            : "Copied task due date",
        );
      persist();
      return structuredClone(changes.map((change) => change.after));
    },
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
    async progressMaterial() {
      throw new ApiError(
        "File processing requires the server workspace. Your file was not sent.",
        503,
      );
    },
    async progressMaterials() {
      return [];
    },
    async analyzeProgress() {
      throw new ApiError(
        "Qwen is unavailable in the browser-only demo. No notes were sent.",
        503,
      );
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
    async progressHistory(id) {
      read();
      const project = state.projects.find((p) => p.id === id);
      if (!project) throw new ApiError("Project not found", 404);
      return progressHistory(project, [...state.activities].reverse());
    },
    async addProgress(id, raw) {
      read();
      const input = progressInput.parse(raw),
        old = state.projects.find((p) => p.id === id);
      if (!old) throw new ApiError("Project not found", 404);
      if (old.version !== input.version)
        throw new ApiError(
          "This project changed in another tab. Review the latest version.",
          409,
          old,
        );
      if (input.mode === "correct" && !old.latestUpdate.trim())
        throw new ApiError(
          "There is no previous progress entry to correct.",
          400,
        );
      const now = new Date().toISOString();
      const project = {
        ...old,
        latestUpdate: input.text,
        reportedAt: input.mode === "new" ? now : old.reportedAt,
        reportedBy: input.mode === "new" ? actor.name : old.reportedBy,
        updatedAt: now,
        version: old.version + 1,
      };
      state.projects = state.projects.map((p) => (p.id === id ? project : p));
      record(
        "project",
        old,
        project,
        input.mode === "new" ? "Progress log" : "Progress correction",
        input.mode === "new"
          ? "Added progress log"
          : "Corrected latest progress log",
        input.originalSource,
      );
      persist();
      return structuredClone(project);
    },
    async renameProject(id, name, version, shortName) {
      read();
      const input = projectRenameInput.parse({ name, version, shortName });
      const old = state.projects.find((p) => p.id === id);
      if (!old) throw new ApiError("Project not found", 404);
      if (old.version !== input.version)
        throw new ApiError(
          "This project changed in another tab. Review the latest version.",
          409,
          old,
        );
      const project = {
        ...old,
        name: input.name,
        shortName: input.shortName ?? old.shortName,
        version: old.version + 1,
        updatedAt: new Date().toISOString(),
      };
      state.projects = state.projects.map((p) => (p.id === id ? project : p));
      record("project", old, project, "Local edit", "Renamed project");
      persist();
      return project;
    },
    async mergeProjects(input) {
      read();
      let plan;
      try {
        plan = planProjectMerge(state, input);
      } catch (e) {
        if (e instanceof ProjectMergeConflict)
          throw new ApiError(e.message, 409);
        throw e;
      }
      const before = structuredClone(state);
      try {
        const sourceIds = new Set(plan.sources.map((p) => p.id));
        state.projects = state.projects
          .filter((p) => !sourceIds.has(p.id))
          .map((p) => (p.id === plan.project.id ? plan.project : p));
        const changed = new Map(
          plan.movedTasks.map(({ after }) => [after.id, after]),
        );
        state.tasks = state.tasks.map((t) => changed.get(t.id) ?? t);
        const members = state.projectMembers ?? [];
        state.projectMembers = members.filter(
          (m) => !sourceIds.has(m.projectId),
        );
        for (const member of members.filter((m) =>
          sourceIds.has(m.projectId),
        )) {
          const existing = state.projectMembers.find(
            (m) =>
              m.projectId === plan.project.id && m.userId === member.userId,
          );
          if (existing) {
            existing.joinedAt = [existing.joinedAt, member.joinedAt].sort()[0]!;
            existing.lastEditedAt = [existing.lastEditedAt, member.lastEditedAt]
              .sort()
              .at(-1)!;
          } else
            state.projectMembers.push({
              ...member,
              projectId: plan.project.id,
            });
        }
        for (const { before, after } of plan.movedTasks)
          record(
            "task",
            before,
            after,
            "Project merge",
            "Moved task to merged project",
          );
        for (const p of plan.sources)
          record("project", p, null, "Project merge", "Merged source project");
        state.activities = state.activities.map((a) =>
          a.projectId && sourceIds.has(a.projectId)
            ? {
                ...a,
                originalProjectId: a.originalProjectId ?? a.projectId,
                projectId: plan.project.id,
              }
            : a,
        );
        record(
          "project",
          plan.target,
          plan.project,
          "Project merge",
          "Merged projects",
        );
        persist();
      } catch (e) {
        state = before;
        throw e;
      }
      return plan.project;
    },
    async companyDirectory() {
      read();
      return structuredClone(state.directory ?? emptyDirectory());
    },
    async saveCompanyDirectory(input) {
      read();
      const parsed = directorySchema.parse(input);
      if (parsed.version !== (state.directory?.version ?? 1))
        throw new ApiError(
          "Company directory changed. Reload before saving.",
          409,
        );
      state.directory = {
        ...parsed,
        version: parsed.version + 1,
        lastSyncedAt: null,
      };
      persist();
      return structuredClone(state.directory);
    },
    async directoryAccounts() {
      read();
      return structuredClone(
        administration().users.map(({ id, name, email, username, status }) => ({
          id,
          name,
          email,
          username,
          status,
        })),
      );
    },
    async wecomSyncState() {
      return { configured: false, lastSyncedAt: null, mode: "local" };
    },
    async syncWecom() {
      throw new ApiError(
        "Enterprise directory sync is not available in the browser demo.",
        503,
      );
    },
    async saveProjectOrder(raw) {
      read();
      const input = projectOrderInput.parse(raw);
      if (input.revision !== state.revision)
        throw new ApiError(
          "Workspace changed. Refresh the project order and try again.",
          409,
        );
      checkProjectOrder(state, input.projectIds);
      const before = state.projectOrder;
      state.projectOrder = input.projectIds;
      record(
        "project",
        null,
        null,
        `Project order\nBefore: ${JSON.stringify(before)}\nAfter: ${JSON.stringify(input.projectIds)}`,
        "Reordered projects",
      );
      persist();
      return [...input.projectIds];
    },
    async reviewTask(): Promise<TaskReview> {
      throw new ApiError("AI review is unavailable in local demo mode.");
    },
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
      const catalogs = importCatalogs(
        parsed,
        state.catalogs ?? defaultCatalogs,
        true,
      );
      state = {
        ...parsed,
        schemaVersion: 2,
        catalogs,
        revision: state.revision,
        activities: state.activities,
        administration: state.administration,
        intakes: state.intakes,
        directory: state.directory,
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
    async accountDefaults() {
      return { starterPasswordConfigured: true };
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
        const updated = {
          ...old,
          ...parsed,
          username: loginName(parsed.name, parsed.username || old.username, id),
          version: old.version + 1,
        };
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
        username: loginName(parsed.name, parsed.username),
        id: crypto.randomUUID(),
        status: parsed.useStarterPassword ? "active" : "pending",
        version: 1,
        activationRequired: !parsed.useStarterPassword,
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
    async saveModelCredential() {
      throw new ApiError("API keys cannot be saved in the browser demo.");
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
      if (a.source === "Project merge")
        throw new ApiError(
          "Project merges cannot be restored as a single record.",
        );
      const taskBefore =
        a.kind === "task" ? taskInput.strip().parse(a.before) : null;
      if (
        taskBefore &&
        !state.projects.some((p) => p.id === taskBefore.projectId)
      )
        taskBefore.projectId = state.tasks.find(
          (t) => t.id === a.entityId,
        )!.projectId;
      return a.kind === "project"
        ? saveProject(
            projectInput.strip().parse(a.before),
            a.entityId,
            version,
            "History restore",
          )
        : saveTask(taskBefore!, a.entityId, version, "History restore");
    },
  };
}
