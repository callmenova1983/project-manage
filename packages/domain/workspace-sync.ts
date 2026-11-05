import { z } from "zod";
import type { Actor, Snapshot, Project, Task } from "./types.js";

/** Business revision remains independent of transport/cache versions. */
export const syncDomains = [
  "core",
  "directory",
  "projectMembers",
  "notifications",
  "usage",
] as const;
export type SyncDomain = (typeof syncDomains)[number];
export type SyncVersions = Record<SyncDomain, string>;
export type WorkspaceCore = Omit<
  Snapshot,
  "activities" | "directory" | "projectMembers"
>;
export type CoreResponse =
  | { version: string; unchanged: true }
  | { version: string; unchanged: false; core: WorkspaceCore };
export interface Bootstrap {
  actor: Actor;
  csrf: string;
  core: WorkspaceCore;
  followingIds: string[];
  versions: SyncVersions;
}
export const receiptInput = z
  .object({
    entities: z
      .array(
        z
          .object({
            kind: z.enum(["project", "task"]),
            id: z.string().min(1).max(100),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type ReceiptInput = z.infer<typeof receiptInput>;
export const emptyVersions = (): SyncVersions => ({
  core: "0",
  directory: "0",
  projectMembers: "0",
  notifications: "0",
  usage: "0",
});
export function workspaceCore(snapshot: Snapshot): WorkspaceCore {
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: snapshot.revision,
    projects: snapshot.projects,
    tasks: snapshot.tasks,
    catalogs: snapshot.catalogs,
    settings: snapshot.settings,
    members: snapshot.members,
    projectOrder: snapshot.projectOrder,
  };
}

/** Generic UI operations also return users, settings and import receipts. Only
 * acknowledged business entities may be merged into the project/task lists. */
export function savedWorkspaceEntities(result: unknown): (Project | Task)[] {
  return (Array.isArray(result) ? result : [result]).filter(
    (item): item is Project | Task =>
      !!item &&
      typeof item === "object" &&
      "id" in item &&
      "version" in item &&
      (("projectId" in item && "status" in item && "title" in item) ||
        ("stage" in item && "owner" in item && "name" in item)),
  );
}
