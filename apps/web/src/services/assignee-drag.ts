import { shallowRef } from "vue";
// Identity stays in this app session. External text/file drops cannot assign people.
export const assigneeDragType = "application/x-project-manage-assignee";
export const assigneeDrag = shallowRef<{
  sourceId: string;
  sourceVersion: number;
  name: string;
  actorId: string;
  workspaceId: string;
} | null>(null);
