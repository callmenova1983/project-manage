import type { InjectionKey } from "vue";

// Collection screens keep details mounted when an edit removes the task's row.
// Embedded project lists can continue to own their detail panel locally.
export const taskDetailsKey: InjectionKey<(taskId: string) => void> =
  Symbol("taskDetails");
