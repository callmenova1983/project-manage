import {
  channelEntry,
  channelEntries,
  defaultChannels,
  projectChannel,
  checkChannels,
} from "./channels.js";
import { loginNameSchema } from "./login-name-schema.js";
import { z } from "zod";
import type { Project, ProjectInput } from "./types.js";
export const catalogEntry = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/),
    en: z.string().trim().min(1).max(60),
    zh: z.string().trim().min(1).max(60),
    order: z.number().int().min(0).max(1000),
    color: z.enum(["purple", "blue", "green", "amber", "rose", "neutral"]),
    archived: z.boolean(),
  })
  .strict();
export const catalogsInput = z
  .object({
    version: z.number().int().positive(),
    stages: z.array(catalogEntry).min(1).max(30),
    categories: z.array(catalogEntry).max(60),
    channels: z.array(channelEntry).min(1).max(60).optional(),
  })
  .strict();
export type CatalogEntry = z.infer<typeof catalogEntry>;
export type Catalogs = z.infer<typeof catalogsInput>;
export const defaultCatalogs: Catalogs = {
  version: 1,
  stages: [
    {
      id: "potential",
      en: "Potential",
      zh: "潜在需求",
      order: 0,
      color: "amber",
      archived: false,
    },
    {
      id: "proposal",
      en: "Proposal & quote",
      zh: "方案与报价",
      order: 1,
      color: "rose",
      archived: false,
    },
    {
      id: "approved",
      en: "Ready to start",
      zh: "已立项待实施",
      order: 2,
      color: "blue",
      archived: false,
    },
    {
      id: "implementation",
      en: "In progress",
      zh: "实施中",
      order: 3,
      color: "purple",
      archived: false,
    },
    {
      id: "operations",
      en: "Operations",
      zh: "验收后运营",
      order: 4,
      color: "green",
      archived: false,
    },
  ],
  categories: [],
  channels: structuredClone(defaultChannels),
};
export const adminUserInput = z
  .object({
    username: loginNameSchema.or(z.literal("")).optional(),
    useStarterPassword: z.boolean().optional(),
    name: z.string().trim().min(1).max(80),
    email: z
      .string()
      .email()
      .max(200)
      .transform((v) => v.toLowerCase()),
    role: z.enum(["member", "admin"]),
  })
  .strict();
export const adminUserUpdate = adminUserInput.extend({
  version: z.number().int().positive(),
  status: z.enum(["active", "disabled", "pending"]),
});
export interface ManagedUser {
  id: string;
  username?: string;
  name: string;
  email: string;
  role: "member" | "admin";
  status: "active" | "disabled" | "pending";
  version: number;
  activationRequired: boolean;
}
export const modelSettingsInput = z
  .object({
    version: z.number().int().positive(),
    enabled: z.boolean(),
    provider: z.literal("qwen"),
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^qwen[a-z0-9._-]*$/),
    region: z.enum([
      "cn-beijing",
      "ap-southeast-1",
      "us-east-1",
      "eu-central-1",
    ]),
    secretRef: z.enum(["", "server-default"]),
    timeoutMs: z.number().int().min(1000).max(30000),
    maxTokens: z.number().int().min(512).max(4096),
  })
  .strict();
export type ModelSettings = z.infer<typeof modelSettingsInput>;
export const modelCredentialInput = z
  .object({
    version: z.number().int().positive(),
    apiKey: z.string().min(1).max(1024).regex(/^\S+$/),
    region: modelSettingsInput.shape.region,
    baseUrl: z.string().max(300).optional(),
    maxRequests: z.number().int().min(1).max(1000),
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .refine(
        (value) => Date.parse(value) > Date.now(),
        "Choose a future allowance expiry",
      ),
  })
  .strict();
export type ModelCredentialInput = z.infer<typeof modelCredentialInput>;
export const modelAllowanceInput = modelCredentialInput.pick({
  version: true,
  maxRequests: true,
  expiresAt: true,
});
export type ModelAllowanceInput = z.infer<typeof modelAllowanceInput>;
export const defaultModelSettings: ModelSettings = {
  version: 1,
  enabled: false,
  provider: "qwen",
  model: "qwen3.8-max",
  region: "cn-beijing",
  secretRef: "",
  timeoutMs: 15000,
  maxTokens: 2048,
};
export interface ModelAdminState {
  credentialEditable?: boolean;
  allowanceEditable?: boolean;
  maxRequests?: number | null;
  usedAttempts?: number;
  settings: ModelSettings;
  credentialAvailable: boolean;
  runtimeEnabled: boolean;
  approvedRegion: string | null;
  approvedModel: string | null;
  remainingAttempts: number;
  expiresAt: string | null;
}
export interface ModelLog {
  purpose?: string;
  instructionVersion?: number;
  runtime?: "legacy" | "sdk";
  audioSeconds?: number | null;
  id: string;
  createdAt: string;
  actor: string;
  provider: string;
  model: string | null;
  mode: "real" | "rules" | "simulated";
  status: "started" | "succeeded" | "failed";
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  errorCode: string | null;
  attempts: number;
  /** Final provider usage per real request, excluding unknown/unreported usage. */
  callUsage?: {
    attempt: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  meteredAttempts?: number;
}
export interface ModelUsage {
  speech?: { recordedSeconds: number; requests: number; unmeasuredRequests: number };
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  measuredRequests: number;
  unmeasuredRequests: number;
  pendingRequests: number;
  last: {
    createdAt: string;
    inputTokens: number | null;
    outputTokens: number | null;
    model: string | null;
  } | null;
}
export interface AdminAudit {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
}
export function checkCatalogs(
  next: Catalogs,
  old: Catalogs,
  projects: Project[],
) {
  catalogsInput.parse(next);
  checkChannels(channelEntries(next), channelEntries(old), projects);
  if (next.stages.some((s) => s.id === "unclassified"))
    throw new Error("Unclassified is a reserved pending stage");
  for (const key of ["stages", "categories"] as const) {
    if (new Set(next[key].map((x) => x.id)).size !== next[key].length)
      throw new Error("Catalog identifiers must be unique");
    if (old[key].some((x) => !next[key].some((n) => n.id === x.id)))
      throw new Error("Archive existing entries instead of deleting them");
  }
  if (!next.stages.some((s) => !s.archived))
    throw new Error("Keep at least one active stage");
  for (const p of projects) {
    if (
      (p.stage !== "unclassified" &&
        !next.stages.some((s) => s.id === p.stage)) ||
      (p.categoryIds ?? []).some(
        (id) => !next.categories.some((c) => c.id === id),
      )
    )
      throw new Error("Catalog would break an existing project reference");
  }
}
export function checkProjectCatalog(
  input: ProjectInput,
  catalogs: Catalogs,
  old?: Project,
) {
  if (
    !channelEntries(catalogs).some(
      (c) =>
        c.id === projectChannel(input) &&
        (!c.archived || (old && projectChannel(old) === c.id)),
    )
  )
    throw new Error("请选择有效渠道。");
  if (
    new Set(input.categoryIds ?? []).size !== (input.categoryIds ?? []).length
  )
    throw new Error("Project categories must be unique");
  if (
    input.stage !== "unclassified" &&
    !catalogs.stages.some(
      (s) => s.id === input.stage && (!s.archived || old?.stage === s.id),
    )
  )
    throw new Error("Choose an active project stage");
  if (
    (input.categoryIds ?? []).some(
      (id) =>
        !catalogs.categories.some(
          (c) => c.id === id && (!c.archived || old?.categoryIds?.includes(id)),
        ),
    )
  )
    throw new Error("Choose active project categories");
}

export function validateCatalogReferences(
  projects: Project[],
  catalogs: Catalogs,
) {
  for (const project of projects) {
    if (!channelEntries(catalogs).some((c) => c.id === projectChannel(project)))
      throw new Error("项目引用了未知渠道。");
    if (
      project.stage !== "unclassified" &&
      !catalogs.stages.some((s) => s.id === project.stage)
    )
      throw new Error("A project references an unknown stage");
    if (
      (project.categoryIds ?? []).some(
        (id) => !catalogs.categories.some((c) => c.id === id),
      )
    )
      throw new Error("A project references an unknown category");
    if (
      new Set(project.categoryIds ?? []).size !==
      (project.categoryIds ?? []).length
    )
      throw new Error("Project categories must be unique");
  }
}
export function importCatalogs(
  input: { schemaVersion: 1 | 2 | 3; catalogs?: Catalogs; projects: Project[] },
  current: Catalogs,
  isAdmin: boolean,
): Catalogs {
  if (input.schemaVersion >= 2 && !input.catalogs)
    throw new Error(`Version ${input.schemaVersion} imports require a catalog`);
  const incoming = input.catalogs;
  let result = current;
  if (
    incoming &&
    JSON.stringify({
      stages: incoming.stages,
      categories: incoming.categories,
      channels: channelEntries(incoming),
    }) !==
      JSON.stringify({
        stages: current.stages,
        categories: current.categories,
        channels: channelEntries(current),
      })
  ) {
    if (!isAdmin)
      throw new Error(
        "Administrator access is required to import catalog changes",
      );
    checkCatalogs(incoming, current, input.projects);
    result = { ...incoming, version: current.version + 1 };
  }
  validateCatalogReferences(input.projects, result);
  return result;
}
