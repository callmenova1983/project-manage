CREATE TABLE wecom_login_config(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),version INTEGER NOT NULL,encrypted_config TEXT NOT NULL);
CREATE TABLE wecom_login_states(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id),config_version INTEGER NOT NULL,return_to TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE wecom_login_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),created_at TEXT NOT NULL,outcome TEXT NOT NULL);
CREATE TABLE wecom_login_sessions(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,workspace_id TEXT NOT NULL,corp_id TEXT NOT NULL,wecom_user_id TEXT NOT NULL);
