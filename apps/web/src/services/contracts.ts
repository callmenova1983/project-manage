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
  saveProject(
    data: ProjectInput,
    id?: string,
    version?: number,
  ): Promise<Project>;
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
}
