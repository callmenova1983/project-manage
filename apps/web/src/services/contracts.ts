import type {
  Bootstrap,
  CoreResponse,
  SyncVersions,
  ReceiptInput,
} from "../../../../packages/domain/workspace-sync";
import type { ProjectMember } from "../../../../packages/domain/directory";
import type {
  WorkspaceDataArchive,
  WorkspaceDataImportResult,
} from "../../../../packages/domain/workspace-transfer";
import type {
  AssistantTurn,
  AssistantTurnInput,
} from "../../../../packages/domain/assistant-plan";
import type {
  SpeechCapabilities,
  SpeechInput,
  SpeechTranscript,
} from "../../../../packages/domain/speech";
import type {
  TaskBulkUpdate,
  TaskBulkConflictItem,
} from "../../../../packages/domain/task-bulk-update";
import type { AssistantSession } from "../../../../packages/domain/assistant";
import type { TaskDependencyReplace } from "../../../../packages/domain/task-dependencies";
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
import type { WorkspaceSettings } from "../../../../packages/domain/time-zone";
import type { MeetingApplyOptions } from "../../../../packages/domain/meeting-completion";
import type {
  ProgressMaterial,
  ProgressAnalysis,
  ProgressAnalysisInput,
} from "../../../../packages/domain/progress-material";
import type { ProjectFile } from "../../../../packages/domain/project-file";
import type {
  ReferenceClassification,
  ReferenceArchiveInput,
} from "../../../../packages/domain/capture-reference";
import type { TaskReview } from "../../../../packages/domain/task-review";
import type { TaskFieldCopyInput } from "../../../../packages/domain/task-field-copy";
import type { TaskLifecycleInput } from "../../../../packages/domain/task-lifecycle";
import type {
  NotificationResponse,
  NotificationActionInput,
  NotificationPreferences,
  NotificationFollowingInput,
} from "../../../../packages/domain/notifications";
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
  ModelAllowanceInput,
  ModelConfigurationInput,
  ModelLog,
  ModelUsage,
  AdminAudit,
} from "../../../../packages/domain/admin";
import type {
  Activity,
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
  ActivityQuery,
  ActivityPage,
} from "../../../../packages/domain/activity-query";
import type {
  IntakeInput,
  IntakeBatch,
} from "../../../../packages/domain/intake";
import type { ProjectMergeInput } from "../../../../packages/domain/project-merge";
import type { ProjectLifecycleInput } from "../../../../packages/domain/project-lifecycle";
import type {
  CompanyDirectory,
  WecomSyncState,
} from "../../../../packages/domain/directory";
import type { ProjectOrderInput } from "../../../../packages/domain/project-order";
import type { ProjectLocationAnalysis } from "../../../../packages/domain/project-location";
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
    public code?: string,
    public conflicts?: TaskBulkConflictItem[],
  ) {
    super(message);
  }
}
/** Notification links stay inside this workspace, including after sign-in. */
export function safeNotificationPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("提醒链接无效，请刷新后重试。");
  const url = new URL(path, "https://workspace.invalid");
  if (url.origin !== "https://workspace.invalid")
    throw new Error("提醒链接无效，请刷新后重试。");
  return url.pathname + url.search + url.hash;
}
export interface WorkspaceApi {
  bootstrap(): Promise<Bootstrap>;
  core(knownVersion?: string): Promise<CoreResponse>;
  meta(): Promise<SyncVersions>;
  receipts(input: ReceiptInput): Promise<Activity[]>;
  projectMembers(
    id: string,
  ): Promise<{ version: string; members: ProjectMember[] }>;
  speechCapabilities(): Promise<SpeechCapabilities>;
  transcribeSpeech(input: SpeechInput): Promise<SpeechTranscript>;
  assistantSession(): Promise<AssistantSession>;
  saveAssistantSession(input: {
    version: number;
    state: Record<string, unknown>;
  }): Promise<AssistantSession>;
  interpretAssistant(input: AssistantTurnInput): Promise<AssistantTurn>;
  translateMap?(
    texts: string[],
  ): Promise<
    import("../../../../packages/domain/map-translation").MapTranslation
  >;
  analyzeProjectLocation(
    id: string,
    version: number,
    externalProcessingConfirmed: true,
  ): Promise<ProjectLocationAnalysis>;
  notifications(): Promise<NotificationResponse>;
  notificationAction(
    input: NotificationActionInput,
  ): Promise<NotificationResponse>;
  saveNotificationPreferences(
    input: NotificationPreferences,
  ): Promise<NotificationResponse>;
  saveNotificationFollowing(
    input: NotificationFollowingInput,
  ): Promise<NotificationResponse>;
  openNotification(id: string): Promise<{ path: string }>;
  dailyLogs(): Promise<DailyLogBatch[]>;
  saveDailyLog(input: DailyLogInput): Promise<DailyLogBatch>;
  bulkFillProjects(input: BulkProjectInput): Promise<Project[]>;
  readonly mode: "server" | "local";
  session(): Promise<{ actor: Actor }>;
  login(email: string, password: string): Promise<{ actor: Actor }>;
  logout(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  copyTaskField(input: TaskFieldCopyInput): Promise<Task[]>;
  moveTask(id: string, input: TaskMoveInput): Promise<Task[]>;
  saveTaskSchedule(id: string, input: TaskSchedulePatch): Promise<Task>;
  saveTaskDependencies(id: string, input: TaskDependencyReplace): Promise<Task>;
  saveTaskScheduleBatch(input: TaskScheduleBatch): Promise<Task[]>;
  bulkUpdateTasks(input: TaskBulkUpdate): Promise<Task[]>;
  taskLifecycle(id: string, input: TaskLifecycleInput): Promise<Task[]>;
  activityPage(query: ActivityQuery): Promise<ActivityPage>;
  exportActivity(query: ActivityQuery): Promise<ActivityPage>;
  saveWorkspaceSettings(
    input: WorkspaceSettings & { confirmed: true },
  ): Promise<WorkspaceSettings>;
  activity(id: string): Promise<Activity>;
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
  changeProjectLifecycle(
    id: string,
    input: ProjectLifecycleInput,
  ): Promise<Project>;
  progressMaterial(
    id: string,
    name: string,
    data: string,
  ): Promise<ProgressMaterial>;
  progressMaterials(id: string, ids: string[]): Promise<ProgressMaterial[]>;
  projectFiles(id: string): Promise<ProjectFile[]>;
  uploadProjectFile(
    id: string,
    name: string,
    data: string,
  ): Promise<ProjectFile>;
  projectFileContent(
    id: string,
    fileId: string,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer>;
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
  wecomConfiguration(): Promise<WecomConfiguration>;
  saveWecomConfiguration(input: WecomConfigInput): Promise<WecomConfiguration>;
  wecomSyncState(): Promise<WecomSyncState>;
  syncWecom(version: number): Promise<CompanyDirectory>;
  saveProjectOrder(input: ProjectOrderInput): Promise<string[]>;
  reviewTask(id: string, version: number): Promise<TaskReview>;
  saveTask(data: TaskInput, id?: string, version?: number): Promise<Task>;
  addTasks(tasks: TaskInput[]): Promise<Task[]>;
  exportData(): Promise<Snapshot>;
  exportWorkspaceData(): Promise<WorkspaceDataArchive>;
  importWorkspaceData(
    archive: WorkspaceDataArchive,
    revision: number,
  ): Promise<WorkspaceDataImportResult>;
  importData(data: unknown, revision: number): Promise<Snapshot>;
  captureMaterial(
    name: string,
    data: string,
    referenceOnly?: boolean,
  ): Promise<ProgressMaterial>;
  extractCaptureMaterial(id: string): Promise<ProgressMaterial>;
  classifyCaptureReferences(
    materialIds: string[],
    notes: string,
  ): Promise<ReferenceClassification>;
  archiveCaptureReferences(
    input: ReferenceArchiveInput,
  ): Promise<ProjectFile[]>;
  analyzeCapture(source: CaptureSource): Promise<CaptureAnalysis>;
  aiCapabilities(): Promise<AiCapabilities>;
  modelUsage(): Promise<ModelUsage>;
  applyProposal(
    proposal: Proposal,
    suggestions: ReviewedSuggestion[],
    options?: MeetingApplyOptions,
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
  saveModelConfiguration(
    input: ModelConfigurationInput,
  ): Promise<ModelAdminState>;
  saveModel(input: ModelSettings): Promise<ModelAdminState>;
  saveModelCredential(input: ModelCredentialInput): Promise<ModelAdminState>;
  saveModelAllowance(input: ModelAllowanceInput): Promise<ModelAdminState>;
  modelLogs(): Promise<ModelLog[]>;
  adminAudit(): Promise<AdminAudit[]>;
}
