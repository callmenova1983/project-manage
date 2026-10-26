import type { Actor } from "../../../../packages/domain/types";
export function accountStorageKey(
  feature: string,
  mode: "server" | "local",
  actor: Pick<Actor, "workspaceId" | "id">,
) {
  return `project-manage-${feature}-v1:${JSON.stringify([mode, actor.workspaceId, actor.id])}`;
}
