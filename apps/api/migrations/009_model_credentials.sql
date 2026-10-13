CREATE TABLE IF NOT EXISTS workspace_ai_credentials (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  encrypted_config TEXT NOT NULL
);
