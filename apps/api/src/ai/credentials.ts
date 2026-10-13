import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Repository } from "../database.js";
import { readQwenConfig, type QwenConfig } from "./config.js";
import type { ModelCredentialInput } from "../../../../packages/domain/admin.js";

/** Workspace credentials are encrypted in SQLite; the key stays beside the private database. */
export class QwenCredentialStore {
  private memoryKey = randomBytes(32);
  constructor(
    private repo: Repository,
    private databasePath: string,
  ) {}
  private key(): Buffer {
    if (this.databasePath === ":memory:") return this.memoryKey;
    const path = resolve(this.databasePath) + ".credentials-key";
    if (!existsSync(path)) {
      if (
        this.repo.db
          .prepare("SELECT 1 FROM workspace_ai_credentials LIMIT 1")
          .get()
      )
        throw new Error("The model credential encryption key is missing");
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
    }
    chmodSync(path, 0o600);
    const key = readFileSync(path);
    if (key.length !== 32)
      throw new Error("Invalid model credential encryption key");
    return key;
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
    return config;
  }
}
