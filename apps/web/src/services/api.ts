import { sha256 } from "./browser-crypto";
import {
  taskBulkConflictsInput,
  type TaskBulkUpdate,
} from "../../../../packages/domain/task-bulk-update";
import type {
  SpeechCapabilities,
  SpeechInput,
  SpeechTranscript,
} from "../../../../packages/domain/speech";
import type {
  AssistantSession,
  AssistantQueryInput,
  AssistantAnswer,
} from "../../../../packages/domain/assistant";
import type { TaskDependencyReplace } from "../../../../packages/domain/task-dependencies";
import type {
  ReferenceClassification,
  ReferenceArchiveInput,
} from "../../../../packages/domain/capture-reference";
import type { TaskMoveInput } from "../../../../packages/domain/task-move";
import type {
  TaskSchedulePatch,
  TaskScheduleBatch,
} from "../../../../packages/domain/task-schedule-write";
import type {
  WecomConfiguration,
  WecomConfigInput,
} from "../../../../packages/domain/directory";
import type {
  DailyLogBatch,
  DailyLogInput,
  BulkProjectInput,
} from "../../../../packages/domain/daily-log";
import type {
  CaptureAnalysis,
  CaptureSource,
} from "../../../../packages/domain/capture";
import type { MeetingApplyOptions } from "../../../../packages/domain/meeting-completion";
import type { TaskFieldCopyInput } from "../../../../packages/domain/task-field-copy";
import type { TaskLifecycleInput } from "../../../../packages/domain/task-lifecycle";
import type {
  NotificationResponse,
  NotificationActionInput,
  NotificationPreferences,
  NotificationFollowingInput,
} from "../../../../packages/domain/notifications";
import type {
  ProgressMaterial,
  ProgressAnalysis,
  ProgressAnalysisInput,
} from "../../../../packages/domain/progress-material";
import type { TaskReview } from "../../../../packages/domain/task-review";
import {
  projectFileUrl,
  type ProjectFile,
} from "../../../../packages/domain/project-file";
import type {
  ProgressEntry,
  ProgressInput,
} from "../../../../packages/domain/progress";
import type { WorkspaceSettings } from "../../../../packages/domain/time-zone";
import type {
  ManagedUser,
  Catalogs,
  ModelAdminState,
  ModelSettings,
  ModelCredentialInput,
  ModelAllowanceInput,
  ModelLog,
  ModelUsage,
  AdminAudit,
} from "../../../../packages/domain/admin";
import type {
  NoteDateInput,
  Activity,
  Actor,
  Project,
  ProjectInput,
  Task,
  TaskInput,
  Snapshot,
  Proposal,
  AiCapabilities,
} from "../../../../packages/domain/types";
import type {
  ActivityQuery,
  ActivityPage,
} from "../../../../packages/domain/activity-query";
import {
  ApiError,
  type WorkspaceApi,
  type ReviewedSuggestion,
} from "./contracts";
import { browserDemo } from "./mode";
import type { ProjectMergeInput } from "../../../../packages/domain/project-merge";
import type {
  CompanyDirectory,
  WecomSyncState,
} from "../../../../packages/domain/directory";
import type { ProjectOrderInput } from "../../../../packages/domain/project-order";
import type {
  IntakeInput,
  IntakeBatch,
} from "../../../../packages/domain/intake";
export { ApiError } from "./contracts";
export type { WorkspaceApi, ReviewedSuggestion } from "./contracts";
export class HttpApi implements WorkspaceApi {
  speechCapabilities() {
    return this.call<SpeechCapabilities>("/assistant/speech");
  }
  transcribeSpeech(input: SpeechInput) {
    return this.call<SpeechTranscript>("/assistant/transcribe", "POST", input);
  }
  assistantSession() {
    return this.call<AssistantSession>("/assistant/session");
  }
  saveAssistantSession(input: {
    version: number;
    state: Record<string, unknown>;
  }) {
    return this.call<AssistantSession>("/assistant/session", "PUT", input);
  }
  queryAssistant(input: AssistantQueryInput) {
    return this.call<AssistantAnswer>("/assistant/query", "POST", input);
  }

  notifications() {
    return this.call<NotificationResponse>("/notifications");
  }
  notificationAction(input: NotificationActionInput) {
    return this.call<NotificationResponse>(
      "/notifications/action",
      "POST",
      input,
    );
  }
  saveNotificationPreferences(input: NotificationPreferences) {
    return this.call<NotificationResponse>(
      "/notifications/preferences",
      "PUT",
      input,
    );
  }
  saveNotificationFollowing(input: NotificationFollowingInput) {
    return this.call<NotificationResponse>(
      "/notifications/following",
      "PUT",
      input,
    );
  }
  openNotification(id: string) {
    return this.call<{ path: string }>(
      `/notifications/${encodeURIComponent(id)}/open`,
    );
  }
  dailyLogs() {
    return this.call<DailyLogBatch[]>("/daily-logs");
  }
  saveDailyLog(input: DailyLogInput) {
    return this.call<DailyLogBatch>("/daily-logs", "POST", input);
  }
  bulkFillProjects(input: BulkProjectInput) {
    return this.call<Project[]>("/projects/bulk-fill", "POST", input);
  }
  readonly mode = "server" as const;
  private csrf = "";
  private actorKey = "";
  private requestSession: Promise<void> | undefined;
  private sessionEpoch = 0;
  private identity(actor: Actor) {
    return typeof actor.id === "string" && typeof actor.workspaceId === "string"
      ? `${actor.workspaceId}:${actor.id}`
      : "";
  }
  private refreshRequestSession() {
    if (!this.requestSession) {
      const epoch = this.sessionEpoch;
      const expectedActor = this.actorKey;
      this.requestSession = this.call<{ actor: Actor; csrf: string }>(
        "/auth/session",
      )
        .then((session) => {
          const actorKey = this.identity(session.actor);
          if (
            epoch !== this.sessionEpoch ||
            (expectedActor && actorKey !== expectedActor)
          )
            throw new ApiError(
              "Your session changed. Refresh the page before trying again.",
              401,
            );
          this.csrf = session.csrf;
          this.actorKey = actorKey;
        })
        .finally(() => {
          this.requestSession = undefined;
        });
    }
    return this.requestSession;
  }
  private async readActivity(path: string, query: ActivityQuery) {
    if (!this.csrf) await this.refreshRequestSession();
    return this.call<ActivityPage>(path, "POST", query);
  }
  private pending = new Map<string, string>();
  private pendingKey = "";
  private restorePending(actor: Actor) {
    this.pendingKey = `project-manage-request-keys:${actor.workspaceId}:${actor.id}`;
    try {
      const saved = JSON.parse(localStorage.getItem(this.pendingKey) || "[]");
      this.pending = new Map(
        Array.isArray(saved)
          ? saved.filter(
              (entry) =>
                Array.isArray(entry) &&
                entry.length === 2 &&
                typeof entry[0] === "string" &&
                typeof entry[1] === "string",
            )
          : [],
      );
    } catch {
      this.pending = new Map();
    }
  }
  private persistPending() {
    if (!this.pendingKey) return;
    try {
      localStorage.setItem(this.pendingKey, JSON.stringify([...this.pending]));
    } catch {
      /* The server still enforces idempotency during this document lifetime. */
    }
  }
  private async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
    recoverToken = true,
  ): Promise<T> {
    const fingerprint = await sha256(method + path + JSON.stringify(body));
    const key = this.pending.get(fingerprint) ?? crypto.randomUUID();
    if (method !== "GET") {
      this.pending.set(fingerprint, key);
      this.persistPending();
    }
    const sentToken = this.csrf;
    const epoch = this.sessionEpoch;
    let response: Response;
    try {
      response = await fetch("/api" + path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": sentToken,
          "idempotency-key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(
          (method === "POST" && path.endsWith("/files")) || path === "/import"
            ? 120000
            : [
                  "/proposals/qwen",
                  "/directory/wecom/sync",
                  "/assistant/transcribe",
                ].includes(path) ||
                path.endsWith("/review") ||
                path.endsWith("/analyze")
              ? 70000
              : 15000,
        ),
      });
    } catch {
      throw new ApiError(
        "Unable to reach the server. Your changes are still here; check the connection and try again.",
      );
    }
    let json;
    try {
      json = await response.json();
      if (json === null || typeof json !== "object") throw new Error();
    } catch {
      // A proxy may return HTML (or an empty body). Never surface that body,
      // and keep the mutation key: the server may already have committed it.
      throw new ApiError(
        "The service returned an unreadable response. Try again when the connection is available.",
        response.status,
      );
    }
    // This response is emitted by the authentication hook before any route or
    // mutation runs. Only this exact rejection is safe to replay automatically.
    // Keep the original idempotency key and payload throughout recovery.
    if (
      recoverToken &&
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      path !== "/auth/login" &&
      path !== "/auth/activate" &&
      response.status === 403 &&
      json.message === "Invalid request token"
    ) {
      if (epoch !== this.sessionEpoch)
        throw new ApiError(
          "Your session changed. Refresh the page before trying again.",
          401,
        );
      // Concurrent requests may already have refreshed the same session.
      if (this.csrf === sentToken) await this.refreshRequestSession();
      if (epoch !== this.sessionEpoch)
        throw new ApiError(
          "Your session changed. Refresh the page before trying again.",
          401,
        );
      return this.call<T>(path, method, body, false);
    }
    if (response.ok || response.status < 500 || json.code?.startsWith("AI_")) {
      this.pending.delete(fingerprint);
      this.persistPending();
    }
    if (
      typeof window !== "undefined" &&
      method === "POST" &&
      (path.endsWith("/classify") ||
        path.endsWith("/analyze") ||
        path.endsWith("/review") ||
        path === "/proposals/qwen" ||
        path === "/assistant/transcribe")
    )
      window.dispatchEvent(new Event("pm:ai-usage-changed"));
    if (!response.ok)
      throw new ApiError(
        json.message ?? "Request failed",
        response.status,
        json.current,
        json.issues,
        typeof json.code === "string" ? json.code : undefined,
        taskBulkConflictsInput.safeParse(json.conflicts).data,
      );
    return json as T;
  }
  async session() {
    const result = await this.call<{ actor: Actor; csrf: string }>(
      "/auth/session",
    );
    this.csrf = result.csrf;
    this.actorKey = this.identity(result.actor);
    this.sessionEpoch++;
    this.restorePending(result.actor);
    return result;
  }
  async login(email: string, password: string) {
    const result = await this.call<{ actor: Actor; csrf: string }>(
      "/auth/login",
      "POST",
      { email, password },
    );
    this.csrf = result.csrf;
    this.actorKey = this.identity(result.actor);
    this.sessionEpoch++;
    this.restorePending(result.actor);
    return result;
  }
  async logout() {
    await this.call("/auth/logout", "POST", {});
    this.csrf = "";
    this.actorKey = "";
    this.sessionEpoch++;
    this.pending.clear();
    this.pendingKey = "";
  }
  snapshot() {
    return this.call<Snapshot>("/workspace");
  }
  copyTaskField(input: TaskFieldCopyInput) {
    return this.call<Task[]>("/tasks/copy-field", "POST", input);
  }
  moveTask(id: string, input: TaskMoveInput) {
    return this.call<Task[]>(`/tasks/${id}/move`, "POST", input);
  }
  taskLifecycle(id: string, input: TaskLifecycleInput) {
    return this.call<Task[]>(`/tasks/${id}/lifecycle`, "POST", input);
  }
  activityPage(query: ActivityQuery) {
    return this.readActivity("/activity/query", query);
  }
  exportActivity(query: ActivityQuery) {
    return this.readActivity("/activity/export", query);
  }
  saveWorkspaceSettings(input: WorkspaceSettings & { confirmed: true }) {
    return this.call<WorkspaceSettings>(
      "/admin/workspace-settings",
      "PUT",
      input,
    );
  }
  activity(id: string) {
    return this.call<Activity>(`/activities/${encodeURIComponent(id)}`);
  }
  translateMap(texts: string[]) {
    return this.call<
      import("../../../../packages/domain/map-translation").MapTranslation
    >("/project-map/translate", "POST", {
      texts,
      externalProcessingConfirmed: true,
    });
  }
  analyzeProjectLocation(
    id: string,
    version: number,
    externalProcessingConfirmed: true,
  ) {
    return this.call<
      import("../../../../packages/domain/project-location").ProjectLocationAnalysis
    >(`/projects/${encodeURIComponent(id)}/location/analyze`, "POST", {
      version,
      externalProcessingConfirmed,
    });
  }
  saveProject(data: ProjectInput, id?: string, version?: number) {
    return this.call<Project>(
      id ? `/projects/${id}` : "/projects",
      id ? "PUT" : "POST",
      id ? { ...data, version } : data,
    );
  }
  addProgress(id: string, input: ProgressInput) {
    return this.call<Project>(`/projects/${id}/progress`, "POST", input);
  }
  progressMaterial(id: string, name: string, data: string) {
    return this.call<ProgressMaterial>(`/projects/${id}/materials`, "POST", {
      name,
      data,
    });
  }
  progressMaterials(id: string, ids: string[]) {
    return this.call<ProgressMaterial[]>(
      `/projects/${id}/materials/list`,
      "POST",
      { ids },
    );
  }
  projectFiles(id: string) {
    return this.call<ProjectFile[]>(
      `/projects/${encodeURIComponent(id)}/files`,
    );
  }
  uploadProjectFile(id: string, name: string, data: string) {
    return this.call<ProjectFile>(
      `/projects/${encodeURIComponent(id)}/files`,
      "POST",
      { name, data },
    );
  }
  async projectFileContent(id: string, fileId: string, signal?: AbortSignal) {
    const response = await fetch(projectFileUrl(id, fileId), {
      credentials: "same-origin",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new ApiError(
        "文件读取失败，请检查登录状态或稍后重试。",
        response.status,
      );
    return response.arrayBuffer();
  }
  analyzeProgress(id: string, input: ProgressAnalysisInput) {
    return this.call<ProgressAnalysis>(
      `/projects/${id}/progress/analyze`,
      "POST",
      input,
    );
  }
  progressHistory(id: string) {
    return this.call<ProgressEntry[]>(`/projects/${id}/progress`);
  }
  reviewTask(id: string, version: number) {
    return this.call<TaskReview>(`/tasks/${id}/review`, "POST", { version });
  }
  saveTaskDependencies(id: string, input: TaskDependencyReplace) {
    return this.call<Task>(`/tasks/${id}/dependencies`, "PUT", input);
  }
  saveTaskSchedule(id: string, input: TaskSchedulePatch) {
    return this.call<Task>(`/tasks/${id}/schedule`, "PATCH", input);
  }
  saveTaskScheduleBatch(input: TaskScheduleBatch) {
    return this.call<Task[]>("/tasks/schedule-batch", "POST", input);
  }
  bulkUpdateTasks(input: TaskBulkUpdate) {
    return this.call<Task[]>("/tasks/bulk-update", "POST", input);
  }
  saveTask(data: TaskInput, id?: string, version?: number) {
    return this.call<Task>(
      id ? `/tasks/${id}` : "/tasks",
      id ? "PUT" : "POST",
      id ? { ...data, version } : data,
    );
  }
  renameProject(id: string, name: string, version: number, shortName?: string) {
    return this.call<Project>(`/projects/${id}/name`, "PUT", {
      name,
      version,
      shortName,
    });
  }
  mergeProjects(input: ProjectMergeInput) {
    return this.call<Project>("/projects/merge", "POST", input);
  }
  companyDirectory() {
    return this.call<CompanyDirectory>("/directory");
  }
  saveCompanyDirectory(input: CompanyDirectory) {
    return this.call<CompanyDirectory>("/directory", "PUT", input);
  }
  directoryAccounts() {
    return this.call<
      {
        id: string;
        name: string;
        email: string;
        username?: string;
        status?: string;
      }[]
    >("/directory/accounts");
  }
  wecomConfiguration() {
    return this.call<WecomConfiguration>("/directory/wecom/config");
  }
  saveWecomConfiguration(input: WecomConfigInput) {
    return this.call<WecomConfiguration>(
      "/directory/wecom/config",
      "PUT",
      input,
    );
  }
  wecomSyncState() {
    return this.call<WecomSyncState>("/directory/wecom");
  }
  syncWecom(version: number) {
    return this.call<CompanyDirectory>("/directory/wecom/sync", "POST", {
      version,
      confirmed: true,
    });
  }
  saveProjectOrder(input: ProjectOrderInput) {
    return this.call<string[]>("/project-order", "PUT", input);
  }
  confirmNoteDate(projectId: string, data: NoteDateInput) {
    return this.call<Task>(`/projects/${projectId}/note-dates`, "POST", data);
  }
  addTasks(tasks: TaskInput[]) {
    return this.call<Task[]>("/tasks/batch", "POST", { tasks });
  }
  exportData() {
    return this.call<Snapshot>("/export");
  }
  importData(data: unknown, revision: number) {
    return this.call<Snapshot>("/import", "POST", {
      ...(data as object),
      revision,
      confirmed: true,
    });
  }
  captureMaterial(name: string, data: string, referenceOnly?: boolean) {
    return this.call<ProgressMaterial>("/capture/materials", "POST", {
      name,
      data,
      ...(referenceOnly ? { referenceOnly: true } : {}),
    });
  }
  extractCaptureMaterial(id: string) {
    return this.call<ProgressMaterial>(
      `/capture/materials/${encodeURIComponent(id)}/extract`,
      "POST",
      {},
    );
  }
  classifyCaptureReferences(materialIds: string[], notes: string) {
    return this.call<ReferenceClassification>("/capture/classify", "POST", {
      materialIds,
      notes,
      externalProcessingConfirmed: true,
    });
  }
  archiveCaptureReferences(input: ReferenceArchiveInput) {
    return this.call<ProjectFile[]>("/capture/archive", "POST", input);
  }
  analyzeCapture(source: CaptureSource) {
    return this.call<CaptureAnalysis>("/capture/analyze", "POST", {
      ...source,
      externalProcessingConfirmed: true,
    });
  }
  propose(
    source: string,
    originalSource?: CaptureSource,
    temporaryMaterialIds?: string[],
  ) {
    return this.call<Proposal>("/proposals", "POST", {
      source,
      ...(originalSource ? { originalSource } : {}),
      ...(temporaryMaterialIds?.length ? { temporaryMaterialIds } : {}),
    });
  }
  aiCapabilities() {
    return this.call<AiCapabilities>("/ai/capabilities");
  }
  modelUsage() {
    return this.call<ModelUsage>("/ai/usage");
  }
  proposeQwen(
    source: string,
    externalProcessingConfirmed: boolean,
    originalSource?: CaptureSource,
  ) {
    return this.call<Proposal>("/proposals/qwen", "POST", {
      source,
      externalProcessingConfirmed,
      ...(originalSource ? { originalSource } : {}),
    });
  }
  applyProposal(
    proposal: Proposal,
    suggestions: ReviewedSuggestion[],
    options?: MeetingApplyOptions,
  ) {
    return this.call<Proposal>(`/proposals/${proposal.id}/apply`, "POST", {
      suggestions,
      ...options,
    });
  }
  restore(id: string, version: number) {
    return this.call<Project | Task>(`/activities/${id}/restore`, "POST", {
      version,
    });
  }
  intakeHistory() {
    return this.call<IntakeBatch[]>("/intakes");
  }
  applyIntake(input: IntakeInput) {
    return this.call<IntakeBatch>("/intakes", "POST", input);
  }
  undoIntake(id: string) {
    return this.call<IntakeBatch>(`/intakes/${id}/undo`, "POST", {
      confirmed: true,
    });
  }
  accountDefaults() {
    return this.call<{ starterPasswordConfigured: boolean }>(
      "/admin/account-defaults",
    );
  }
  adminUsers() {
    return this.call<ManagedUser[]>("/admin/users");
  }
  saveUser(
    input: Pick<ManagedUser, "name" | "email" | "role"> &
      Partial<Pick<ManagedUser, "status" | "version">>,
    id?: string,
  ) {
    return this.call<ManagedUser>(
      id ? `/admin/users/${id}` : "/admin/users",
      id ? "PUT" : "POST",
      input,
    );
  }
  userActivation(id: string) {
    return this.call<{
      token: string | null;
      expiresAt: string;
      simulated: boolean;
    }>(`/admin/users/${id}/activation`, "POST", { confirmed: true });
  }
  async activateAccount(token: string, password: string) {
    await this.call("/auth/activate", "POST", { token, password });
  }
  catalogs() {
    return this.call<Catalogs>("/catalogs");
  }
  saveCatalogs(input: Catalogs) {
    return this.call<Catalogs>("/admin/catalogs", "PUT", input);
  }
  modelAdmin() {
    return this.call<ModelAdminState>("/admin/model");
  }
  saveModel(input: ModelSettings) {
    return this.call<ModelAdminState>("/admin/model", "PUT", input);
  }
  saveModelCredential(input: ModelCredentialInput) {
    return this.call<ModelAdminState>("/admin/model/credential", "PUT", input);
  }
  saveModelAllowance(input: ModelAllowanceInput) {
    return this.call<ModelAdminState>("/admin/model/allowance", "PUT", input);
  }
  modelLogs() {
    return this.call<ModelLog[]>("/admin/model/logs");
  }
  adminAudit() {
    return this.call<AdminAudit[]>("/admin/audit");
  }
}
export const api: WorkspaceApi = browserDemo
  ? (await import("./local")).createLocalApi()
  : new HttpApi();
