import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { workspaceCredentialKey } from "../credential-key.js";
import type { Repository } from "../database.js";
import { readQwenConfig, type QwenConfig } from "./config.js";
import type {
  ModelAllowanceInput,
  ModelCredentialInput,
} from "../../../../packages/domain/admin.js";

/** Workspace credentials are encrypted in SQLite; the key stays beside the private database. */
export class QwenCredentialStore {
  private memoryKey = randomBytes(32);
  constructor(
    private repo: Repository,
    private databasePath: string,
  ) {}
  private key(): Buffer {
    return workspaceCredentialKey(this.repo, this.databasePath, this.memoryKey);
  }

  read(workspaceId: string): QwenConfig | undefined {
    const row = this.repo.db
      .prepare(
        "SELECT encrypted_config FROM workspace_ai_credentials WHERE workspace_id=?",
      )
      .get(workspaceId);
    if (!row) return;
    const [iv, tag, data] = String(row.encrypted_config).split(".");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(iv!, "base64"),
    );
    cipher.setAAD(Buffer.from(workspaceId));
    cipher.setAuthTag(Buffer.from(tag!, "base64"));
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(data!, "base64")),
        cipher.final(),
      ]).toString(),
    ) as QwenConfig;
  }
  save(workspaceId: string, input: ModelCredentialInput): QwenConfig {
    const shared = {
      "cn-beijing": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "ap-southeast-1":
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "us-east-1": "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
      "eu-central-1": "",
    };
    const config = readQwenConfig({
      AI_PROVIDER: "qwen",
      AI_CALLS_ENABLED: "true",
      QWEN_REGION: input.region,
      QWEN_BASE_URL: input.baseUrl || shared[input.region],
      DASHSCOPE_API_KEY: input.apiKey,
      AI_BUDGET_ID:
        "workspace-" +
        createHash("sha256").update(workspaceId).digest("hex").slice(0, 32),
      AI_MAX_REQUESTS: String(input.maxRequests),
      AI_BUDGET_EXPIRES_AT: input.expiresAt,
      AI_TIMEOUT_MS: "30000",
      AI_MAX_OUTPUT_TOKENS: "4096",
      AI_MAX_RETRIES: "0",
    })!;
    this.write(workspaceId, config);
    return config;
  }
  updateAllowance(workspaceId: string, input: ModelAllowanceInput): QwenConfig {
    const current = this.read(workspaceId);
    if (!current)
      throw new Error("Workspace model credential is not configured");
    const next = {
      ...current,
      maxRequests: input.maxRequests,
      expiresAt: Date.parse(input.expiresAt),
    };
    // Keep the same ledger identity: approval changes the total ceiling, never
    // resets already billed attempts or rotates credentials behind the form.
    this.write(workspaceId, next);
    return next;
  }
  private write(workspaceId: string, config: QwenConfig) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(workspaceId));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(config)),
      cipher.final(),
    ]);
    const encrypted = [iv, cipher.getAuthTag(), data]
      .map((b) => b.toString("base64"))
      .join(".");
    this.repo.db
      .prepare(
        "INSERT INTO workspace_ai_credentials(workspace_id,encrypted_config) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET encrypted_config=excluded.encrypted_config",
      )
      .run(workspaceId, encrypted);
  }
}
