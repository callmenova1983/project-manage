-- Additive migration. Versions are transaction-scoped and independent of business revision.
CREATE TABLE workspace_sync_versions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  version BIGINT NOT NULL DEFAULT 1,
  transaction_id BIGINT NOT NULL,
  PRIMARY KEY(workspace_id,domain,user_id)
);
CREATE TABLE notification_jobs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  target_version BIGINT NOT NULL DEFAULT 1,
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Keep suppression attached to the original events when several writes coalesce.
CREATE TABLE notification_suppressed_activities (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE
);
CREATE FUNCTION pm_sync_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; ws text; recipient text; domain_name text; v bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  ws := CASE WHEN TG_TABLE_NAME = 'workspaces' THEN row_data->>'id' ELSE row_data->>'workspace_id' END;
  -- Cascading deletes no longer have a parent to version.
  IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=ws) THEN RETURN NULL; END IF;
  FOREACH domain_name IN ARRAY string_to_array(TG_ARGV[0], ',') LOOP
    recipient := CASE WHEN domain_name='notifications' THEN COALESCE(row_data->>'user_id','') ELSE '' END;
    INSERT INTO workspace_sync_versions(workspace_id,domain,user_id,version,transaction_id)
      VALUES(ws,domain_name,recipient,1,txid_current())
      ON CONFLICT(workspace_id,domain,user_id) DO UPDATE
      SET version=workspace_sync_versions.version + 1,
          transaction_id=txid_current()
      WHERE workspace_sync_versions.transaction_id<>txid_current()
      RETURNING version INTO v;
    IF v IS NOT NULL THEN
    PERFORM pg_notify('pm_workspace_sync', json_build_object('schema',TG_TABLE_SCHEMA,'workspaceId',ws,'domain',domain_name,'userId',recipient,'version',v::text)::text);
    IF domain_name='core' OR domain_name='directory' THEN
      INSERT INTO notification_jobs(workspace_id) VALUES(ws)
      ON CONFLICT(workspace_id) DO UPDATE SET target_version=notification_jobs.target_version+1,updated_at=clock_timestamp();
    END IF;
    END IF;
  END LOOP;
  IF TG_TABLE_NAME='activities' AND TG_OP='INSERT' AND current_setting('pm.suppress_notifications',true)='on' THEN
    INSERT INTO notification_suppressed_activities(activity_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER pm_sync_workspaces AFTER INSERT OR UPDATE OR DELETE ON workspaces FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core,notifications');
CREATE TRIGGER pm_sync_projects AFTER INSERT OR UPDATE OR DELETE ON projects FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core');
CREATE TRIGGER pm_sync_tasks AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core');
CREATE TRIGGER pm_sync_activities AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core');
CREATE TRIGGER pm_sync_workspace_catalogs AFTER INSERT OR UPDATE OR DELETE ON workspace_catalogs FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core');
CREATE TRIGGER pm_sync_workspace_project_order AFTER INSERT OR UPDATE OR DELETE ON workspace_project_order FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core');
CREATE TRIGGER pm_sync_users AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION pm_sync_change('core,directory,projectMembers');
CREATE TRIGGER pm_sync_workspace_directory AFTER INSERT OR UPDATE OR DELETE ON workspace_directory FOR EACH ROW EXECUTE FUNCTION pm_sync_change('directory,projectMembers');
CREATE TRIGGER pm_sync_project_members AFTER INSERT OR UPDATE OR DELETE ON project_members FOR EACH ROW EXECUTE FUNCTION pm_sync_change('projectMembers');
CREATE TRIGGER pm_sync_notifications AFTER INSERT OR UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION pm_sync_change('notifications');
CREATE TRIGGER pm_sync_notification_accounts AFTER INSERT OR UPDATE OR DELETE ON notification_accounts FOR EACH ROW EXECUTE FUNCTION pm_sync_change('notifications');
CREATE TRIGGER pm_sync_model_logs AFTER INSERT OR UPDATE OR DELETE ON model_logs FOR EACH ROW EXECUTE FUNCTION pm_sync_change('usage');
CREATE TRIGGER pm_sync_model_settings AFTER INSERT OR UPDATE OR DELETE ON model_settings FOR EACH ROW EXECUTE FUNCTION pm_sync_change('usage');
INSERT INTO workspace_sync_versions(workspace_id,domain,transaction_id)
SELECT w.id,d.domain,txid_current() FROM workspaces w CROSS JOIN
(VALUES ('core'),('directory'),('projectMembers'),('usage')) d(domain);
INSERT INTO notification_jobs(workspace_id) SELECT id FROM workspaces;
CREATE INDEX activity_receipt ON activities(workspace_id, (data::jsonb->>'kind'), (data::jsonb->>'entityId'), ((data::jsonb->'after'->>'version')));
-- Preserve original text timestamps for old clients; indexed instants serve new history reads.
ALTER TABLE activities ADD COLUMN occurred_at TIMESTAMPTZ;
UPDATE activities SET occurred_at=created_at::timestamptz;
CREATE FUNCTION pm_activity_instant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.occurred_at:=NEW.created_at::timestamptz; RETURN NEW; END $$;
CREATE TRIGGER pm_activity_instant BEFORE INSERT OR UPDATE OF created_at ON activities
FOR EACH ROW EXECUTE FUNCTION pm_activity_instant();
ALTER TABLE activities ALTER COLUMN occurred_at SET NOT NULL;
CREATE INDEX activity_page_instant ON activities(workspace_id,occurred_at DESC,id COLLATE "C" ASC) INCLUDE(rowid);

CREATE TRIGGER pm_sync_notification_config AFTER INSERT OR UPDATE OR DELETE ON notification_wecom_config FOR EACH ROW EXECUTE FUNCTION pm_sync_change('notifications');
CREATE TRIGGER pm_sync_notification_scope AFTER INSERT OR UPDATE OR DELETE ON notification_directory_scope FOR EACH ROW EXECUTE FUNCTION pm_sync_change('notifications');
CREATE TRIGGER pm_sync_notification_bindings AFTER INSERT OR UPDATE OR DELETE ON notification_bindings FOR EACH ROW EXECUTE FUNCTION pm_sync_change('notifications');
