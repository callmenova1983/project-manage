/** Design draft only. Runtime validation and persistence are not implemented. */
export type Id = string;
export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'member';
export interface FieldDefinition {
  id: Id;
  name: string;
  kind: FieldKind;
  required: boolean;
  options?: { id: Id; label: string }[];
}
export interface WorkflowState {
  id: Id;
  name: string;
  order: number;
  allowedNextStateIds: Id[];
}
export interface Project {
  id: Id;
  workspaceId: Id;
  name: string;
  fields: FieldDefinition[];
  states: WorkflowState[];
}
export type FieldValue = string | number | string[] | null;
export interface Task {
  id: Id;
  workspaceId: Id;
  projectId: Id;
  title: string;
  description: string;
  stateId: Id;
  assigneeIds: Id[];
  dueAt: string | null;
  customFields: Record<Id, FieldValue>;
  version: number;
}
export interface AiProposal {
  id: Id;
  workspaceId: Id;
  projectId: Id;
  status: 'draft' | 'approved' | 'rejected' | 'applied' | 'failed';
  summary: string;
  createdBy: Id;
  createdAt: string;
}
