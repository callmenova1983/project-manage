CREATE TABLE IF NOT EXISTS workspace_directory (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  last_edited_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,project_id,user_id),
  FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_project_order (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  data TEXT NOT NULL
);
