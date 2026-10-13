-- Preserve existing rows and provide a timezone-normalized full-history range index.
CREATE INDEX activity_workspace_instant ON activities(workspace_id, julianday(created_at) DESC, id);
