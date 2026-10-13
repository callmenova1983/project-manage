CREATE TABLE progress_materials_scoped (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL,
  bytes BLOB NOT NULL,
  images TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id)
);
INSERT INTO progress_materials_scoped SELECT * FROM progress_materials;
DROP TABLE progress_materials;
ALTER TABLE progress_materials_scoped RENAME TO progress_materials;
CREATE INDEX progress_materials_project ON progress_materials(workspace_id,project_id);
