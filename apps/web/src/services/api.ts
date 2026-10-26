import type { WorkspaceSettings } from "../../../../packages/domain/time-zone";
import type {
  ManagedUser,
  Catalogs,
  ModelAdminState,
  ModelSettings,
  ModelLog,
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
import type {
  IntakeInput,
  IntakeBatch,
} from "../../../../packages/domain/intake";
export { ApiError } from "./contracts";
export type { WorkspaceApi, ReviewedSuggestion } from "./contracts";
export class HttpApi implements WorkspaceApi {
  readonly mode = "server" as const;
  private csrf = "";
  private pending = new Map<string, string>();
  private async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const fingerprint = method + path + JSON.stringify(body);
    const key = this.pending.get(fingerprint) ?? crypto.randomUUID();
    if (method !== "GET") this.pending.set(fingerprint, key);
    let response: Response;
    try {
      response = await fetch("/api" + path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": this.csrf,
          "idempotency-key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(path === "/proposals/qwen" ? 70000 : 15000),
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
    if (response.ok || response.status < 500 || json.code?.startsWith("AI_"))
      this.pending.delete(fingerprint);
    if (!response.ok)
      throw new ApiError(
        json.message ?? "Request failed",
        response.status,
        json.current,
        json.issues,
      );
    return json as T;
  }
  async session() {
    const result = await this.call<{ actor: Actor; csrf: string }>(
      "/auth/session",
    );
    this.csrf = result.csrf;
    return result;
  }
  async login(email: string, password: string) {
    const result = await this.call<{ actor: Actor; csrf: string }>(
      "/auth/login",
      "POST",
      { email, password },
    );
    this.csrf = result.csrf;
    return result;
  }
  async logout() {
    await this.call("/auth/logout", "POST", {});
    this.csrf = "";
  }
  snapshot() {
    return this.call<Snapshot>("/workspace");
  }
  activityPage(query: ActivityQuery) {
    return this.call<ActivityPage>("/activity/query", "POST", query);
  }
  exportActivity(query: ActivityQuery) {
    return this.call<ActivityPage>("/activity/export", "POST", query);
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
  saveProject(data: ProjectInput, id?: string, version?: number) {
    return this.call<Project>(
      id ? `/projects/${id}` : "/projects",
      id ? "PUT" : "POST",
      id ? { ...data, version } : data,
    );
  }
  saveTask(data: TaskInput, id?: string, version?: number) {
    return this.call<Task>(
      id ? `/tasks/${id}` : "/tasks",
      id ? "PUT" : "POST",
      id ? { ...data, version } : data,
    );
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
  propose(source: string) {
    return this.call<Proposal>("/proposals", "POST", { source });
  }
  aiCapabilities() {
    return this.call<AiCapabilities>("/ai/capabilities");
  }
  proposeQwen(source: string, externalProcessingConfirmed: boolean) {
    return this.call<Proposal>("/proposals/qwen", "POST", {
      source,
      externalProcessingConfirmed,
    });
  }
  applyProposal(proposal: Proposal, suggestions: ReviewedSuggestion[]) {
    return this.call<Proposal>(`/proposals/${proposal.id}/apply`, "POST", {
      suggestions,
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
