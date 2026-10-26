-- Earlier records did not distinguish reports from ordinary edits.
-- Keep unknown report times unknown instead of inventing a report timestamp.
UPDATE projects SET data = json_set(data, '$.reportedAt', NULL, '$.reportedBy', NULL)
WHERE json_type(data, '$.reportedAt') IS NULL;
