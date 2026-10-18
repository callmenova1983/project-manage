-- Preserve the existing insertion order within each task's sibling group.
WITH ordered AS (
  SELECT workspace_id, id,
    row_number() OVER (
      PARTITION BY workspace_id, project_id, json_extract(data, '$.parentId')
      ORDER BY rowid
    ) - 1 AS sort_order
  FROM tasks
)
UPDATE tasks SET data=json_set(data, '$.sortOrder', (
  SELECT sort_order FROM ordered
  WHERE ordered.workspace_id=tasks.workspace_id AND ordered.id=tasks.id
)) WHERE json_extract(data, '$.sortOrder') IS NULL;
