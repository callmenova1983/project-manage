CREATE TABLE workspace_project_order (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  data TEXT NOT NULL
);
