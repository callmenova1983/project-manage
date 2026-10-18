CREATE TABLE IF NOT EXISTS workspace_wecom_credentials (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  version INTEGER NOT NULL,
  encrypted_config TEXT NOT NULL
);
