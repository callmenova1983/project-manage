import { z } from "zod";
import { DomainError, type Project, type Snapshot } from "./types.js";
export const projectOrderInput = z
  .object({
    projectIds: z.array(z.string().min(1).max(100)).max(1000),
    revision: z.number().int().positive(),
  })
  .strict();
export type ProjectOrderInput = z.infer<typeof projectOrderInput>;
export function orderedProjectIds(projects: Project[], saved: string[] = []) {
  const ids = new Set(projects.map((p) => p.id));
  const valid = [...new Set(saved)].filter((id) => ids.has(id));
  const included = new Set(valid);
  return [
    ...valid,
    ...[...projects]
      .sort((a, b) => (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""))
      .filter((p) => !included.has(p.id))
      .map((p) => p.id),
  ];
}
export function checkProjectOrder(snapshot: Snapshot, ids: string[]) {
  if (
    ids.length !== snapshot.projects.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !snapshot.projects.some((p) => p.id === id))
  )
    throw new DomainError(
      "Project order must include every current project exactly once.",
    );
}
