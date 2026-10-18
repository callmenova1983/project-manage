CREATE TABLE notification_accounts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  preferences TEXT NOT NULL,
  following TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE notification_cursors (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  activity_row INTEGER NOT NULL,
  initialized_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  logical_key TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  signature TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(workspace_id,user_id,logical_key)
);
CREATE INDEX notification_recipient ON notifications(workspace_id,user_id);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  generation INTEGER NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  config_version INTEGER,
  binding_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(notification_id,generation)
);
CREATE INDEX notification_due ON notification_outbox(state,next_at);
CREATE TABLE notification_wecom_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  version INTEGER NOT NULL,
  encrypted_config TEXT NOT NULL
);
CREATE TABLE notification_bindings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  employee_id TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  wecom_user_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE notification_directory_scope (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  corp_id TEXT NOT NULL,
  directory_version INTEGER NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE TABLE project_redirects (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,source_id)
);
