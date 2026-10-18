import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Repository } from "./database.js";
import { workspaceCredentialKey } from "./credential-key.js";
import type { WecomConfig } from "./wecom.js";
export class WecomCredentialStore {
  private memoryKey = randomBytes(32);
  constructor(
    private repo: Repository,
    private databasePath: string,
  ) {}
  private key() {
    return workspaceCredentialKey(this.repo, this.databasePath, this.memoryKey);
  }
  read(
    workspaceId: string,
  ): { version: number; config: WecomConfig } | undefined {
    const row = this.repo.db
      .prepare(
        "SELECT version,encrypted_config FROM workspace_wecom_credentials WHERE workspace_id=?",
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
    return {
      version: Number(row.version),
      config: JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(data!, "base64")),
          cipher.final(),
        ]).toString(),
      ) as WecomConfig,
    };
  }
  save(workspaceId: string, config: WecomConfig, version: number) {
    const iv = randomBytes(12);
    const encoder = createCipheriv("aes-256-gcm", this.key(), iv);
    encoder.setAAD(Buffer.from(workspaceId));
    const data = Buffer.concat([
      encoder.update(JSON.stringify(config)),
      encoder.final(),
    ]);
    const encrypted = [iv, encoder.getAuthTag(), data]
      .map((b) => b.toString("base64"))
      .join(".");
    this.repo.db
      .prepare(
        "INSERT INTO workspace_wecom_credentials(workspace_id,version,encrypted_config) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version,encrypted_config=excluded.encrypted_config",
      )
      .run(workspaceId, version, encrypted);
  }
}
