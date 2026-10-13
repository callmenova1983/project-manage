CREATE TABLE progress_materials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL,
  bytes BLOB NOT NULL,
  images TEXT NOT NULL
);
CREATE INDEX progress_materials_project ON progress_materials(workspace_id,project_id);
