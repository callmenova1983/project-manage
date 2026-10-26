CREATE TABLE IF NOT EXISTS ai_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('started','succeeded','failed')),
  response TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS ai_attempts (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_attempt_budget ON ai_attempts(budget_id);
