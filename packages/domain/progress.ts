import {
  progressSourceSchema,
  type ProgressSource,
} from "./progress-material.js";
import { z } from "zod";
import type { Activity, Project } from "./types.js";
export const progressInput = z
  .object({
    text: z.string().trim().min(1).max(4000),
    version: z.number().int().positive(),
    mode: z.enum(["new", "correct"]),
    originalSource: progressSourceSchema.optional(),
  })
  .strict();
export type ProgressInput = z.infer<typeof progressInput>;
export interface ProgressEntry {
  id: string;
  text: string;
  author: string | null;
  reportedAt: string | null;
  recordedAt: string | null;
  correction: boolean;
  originalSource?: ProgressSource;
}
export function progressHistory(
  project: Project,
  activities: Activity[],
): ProgressEntry[] {
  const events = activities
    .filter(
      (a) =>
        a.kind === "project" &&
        a.projectId === project.id &&
        a.after &&
        "latestUpdate" in a.after &&
        (a.source === "Progress log" ||
          a.source === "Progress correction" ||
          a.after.latestUpdate !==
            (a.before && "latestUpdate" in a.before
              ? a.before.latestUpdate
              : "")),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const entries: ProgressEntry[] = [];
  const first = events[0]?.before as Project | null | undefined;
  if (first?.latestUpdate.trim())
    entries.push({
      id: "original-" + project.id,
      text: first.latestUpdate,
      author: first.reportedBy,
      reportedAt: first.reportedAt,
      recordedAt: null,
      correction: false,
    });
  for (const event of events) {
    const after = event.after as Project;
    if (!after.latestUpdate.trim()) continue;
    entries.push({
      id: event.id,
      originalSource:
        event.progressSource ??
        (event.source === "Progress correction"
          ? entries.at(-1)?.originalSource
          : undefined),
      text: after.latestUpdate,
      author:
        event.source === "Progress correction"
          ? event.actor
          : (after.reportedBy ?? null),
      reportedAt: after.reportedAt,
      recordedAt: event.createdAt,
      correction: event.source === "Progress correction",
    });
  }
  if (!entries.length && project.latestUpdate.trim())
    entries.push({
      id: "original-" + project.id,
      text: project.latestUpdate,
      author: project.reportedBy,
      reportedAt: project.reportedAt,
      recordedAt: null,
      correction: false,
    });
  return entries.reverse();
}
