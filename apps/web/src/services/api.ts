import type {
  Actor,
  Project,
  ProjectInput,
  Task,
  TaskInput,
  Snapshot,
  Proposal,
} from "../../../../packages/domain/types";
import {
  ApiError,
  type WorkspaceApi,
  type ReviewedSuggestion,
} from "./contracts";
export { ApiError } from "./contracts";
export type { WorkspaceApi, ReviewedSuggestion } from "./contracts";
class HttpApi implements WorkspaceApi {
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
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(
        "Unable to reach the server. Your changes are still here; check the connection and try again.",
      );
    }
    const json = await response.json();
    if (response.ok || response.status < 500) this.pending.delete(fingerprint);
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
}
export const api: WorkspaceApi =
  import.meta.env.VITE_DEMO_MODE === "1"
    ? (await import("./local")).createLocalApi()
    : new HttpApi();
