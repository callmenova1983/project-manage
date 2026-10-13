import type {
  ProgressMaterial,
  ProgressAnalysis,
  ProgressAnalysisInput,
} from "../../../../packages/domain/progress-material";
import type { TaskReview } from "../../../../packages/domain/task-review";
import type { TaskFieldCopyInput } from "../../../../packages/domain/task-field-copy";
import type {
  ProgressEntry,
  ProgressInput,
} from "../../../../packages/domain/progress";
import type {
  ManagedUser,
  Catalogs,
  ModelAdminState,
  ModelSettings,
  ModelCredentialInput,
  ModelLog,
  AdminAudit,
} from "../../../../packages/domain/admin";
import type {
  NoteDateInput,
  Actor,
  Project,
  ProjectInput,
  Task,
  TaskInput,
  Snapshot,
  Proposal,
  Suggestion,
  AiCapabilities,
} from "../../../../packages/domain/types";
import type {
  IntakeInput,
  IntakeBatch,
} from "../../../../packages/domain/intake";
import type { ProjectMergeInput } from "../../../../packages/domain/project-merge";
import type {
  CompanyDirectory,
  WecomSyncState,
} from "../../../../packages/domain/directory";
import type { ProjectOrderInput } from "../../../../packages/domain/project-order";
export type ReviewedSuggestion = Pick<
  Suggestion,
  | "id"
  | "selectedProjectId"
  | "title"
  | "action"
  | "status"
  | "confirmed"
  | "overwriteConfirmed"
> & { projectVersion?: number };
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public current?: Project | Task,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}
export interface WorkspaceApi {
  readonly mode: "server" | "local";
  session(): Promise<{ actor: Actor }>;
  login(email: string, password: string): Promise<{ actor: Actor }>;
  logout(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  copyTaskField(input: TaskFieldCopyInput): Promise<Task[]>;
  saveProject(
    data: ProjectInput,
    id?: string,
    version?: number,
  ): Promise<Project>;
  renameProject(
    id: string,
    name: string,
    version: number,
    shortName?: string,
  ): Promise<Project>;
  progressMaterial(
    id: string,
    name: string,
    data: string,
  ): Promise<ProgressMaterial>;
  progressMaterials(id: string, ids: string[]): Promise<ProgressMaterial[]>;
  analyzeProgress(
    id: string,
    input: ProgressAnalysisInput,
  ): Promise<ProgressAnalysis>;
  addProgress(id: string, input: ProgressInput): Promise<Project>;
  progressHistory(id: string): Promise<ProgressEntry[]>;
  mergeProjects(input: ProjectMergeInput): Promise<Project>;
  companyDirectory(): Promise<CompanyDirectory>;
  saveCompanyDirectory(input: CompanyDirectory): Promise<CompanyDirectory>;
  directoryAccounts(): Promise<
    {
      id: string;
      name: string;
      email: string;
      username?: string;
      status?: string;
    }[]
  >;
  wecomSyncState(): Promise<WecomSyncState>;
  syncWecom(version: number): Promise<CompanyDirectory>;
  saveProjectOrder(input: ProjectOrderInput): Promise<string[]>;
  reviewTask(id: string, version: number): Promise<TaskReview>;
  saveTask(data: TaskInput, id?: string, version?: number): Promise<Task>;
  confirmNoteDate(projectId: string, data: NoteDateInput): Promise<Task>;
  addTasks(tasks: TaskInput[]): Promise<Task[]>;
  exportData(): Promise<Snapshot>;
  importData(data: unknown, revision: number): Promise<Snapshot>;
  propose(source: string): Promise<Proposal>;
  aiCapabilities(): Promise<AiCapabilities>;
  proposeQwen(
    source: string,
    externalProcessingConfirmed: boolean,
  ): Promise<Proposal>;
  applyProposal(
    proposal: Proposal,
    suggestions: ReviewedSuggestion[],
  ): Promise<Proposal>;
  restore(id: string, version: number): Promise<Project | Task>;
  intakeHistory(): Promise<IntakeBatch[]>;
  applyIntake(input: IntakeInput): Promise<IntakeBatch>;
  undoIntake(id: string): Promise<IntakeBatch>;
  accountDefaults(): Promise<{ starterPasswordConfigured: boolean }>;
  adminUsers(): Promise<ManagedUser[]>;
  saveUser(
    input: Pick<ManagedUser, "name" | "email" | "role"> &
      Partial<Pick<ManagedUser, "status" | "version">>,
    id?: string,
  ): Promise<ManagedUser>;
  userActivation(
    id: string,
  ): Promise<{ token: string | null; expiresAt: string; simulated: boolean }>;
  activateAccount(token: string, password: string): Promise<void>;
  catalogs(): Promise<Catalogs>;
  saveCatalogs(input: Catalogs): Promise<Catalogs>;
  modelAdmin(): Promise<ModelAdminState>;
  saveModel(input: ModelSettings): Promise<ModelAdminState>;
  saveModelCredential(input: ModelCredentialInput): Promise<ModelAdminState>;
  modelLogs(): Promise<ModelLog[]>;
  adminAudit(): Promise<AdminAudit[]>;
}
