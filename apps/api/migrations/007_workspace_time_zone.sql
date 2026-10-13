-- Existing workspaces keep UTC. Business timestamps and calendar dates are untouched.
ALTER TABLE workspaces ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE workspaces ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 1;
