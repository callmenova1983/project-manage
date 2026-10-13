CREATE TABLE intake_batches (id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace_id,id));
CREATE INDEX intake_workspace_date ON intake_batches(workspace_id,created_at DESC);
