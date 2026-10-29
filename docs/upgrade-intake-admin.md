# Upgrade, backup and recovery

The current runtime uses PostgreSQL only. Historical migration numbers 004/005 described the earlier SQLite release; they are not PostgreSQL migration instructions. For a first transition from SQLite, use the full-data import procedure in [PostgreSQL deployment](postgresql.md).

## Prepare the deployment

1. Record the current release and the server's private runtime configuration path. Keep the same `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_SCHEMA`, `CREDENTIAL_KEY_PATH`, origin and existing AI settings unless changing them is part of the deployment.
2. Keep production configuration outside the release checkout. Use `DOTENV_CONFIG_PATH=/etc/pm-system/production.env` for Node/CLI, or `PM_ENV_FILE=/etc/pm-system/production.env` with Compose. Actual credentials are never copied into the repository or a frontend variable.
3. Stop the service through its actual manager and quiesce other writers for a coordinated upgrade. Preserve the original credential encryption key. Do not seed demo projects or reset accounts during deployment.

## Backup before migration

Install PostgreSQL client tools at least as new as the server (the current Docker image includes client 17). Choose a new private absolute destination:

```bash
DOTENV_CONFIG_PATH=/etc/pm-system/production.env node dist/server/apps/api/src/backup-cli.js /private/backups/before-upgrade.dump
```

The command runs `pg_dump`, checks archive readability, and copies the separate key when present. It never overwrites an existing backup. Keep the archive and key together in private storage. A workspace JSON export does not replace a database backup.

## Apply the new release

```bash
DOTENV_CONFIG_PATH=/etc/pm-system/production.env node dist/server/apps/api/src/cli.js migrate
```

Migrations are recorded in the configured PostgreSQL schema and are transactionally serialized. Confirm the target database and schema before execution. Compare account/project/task/activity counts with the pre-upgrade records, then start the new service with the same private configuration. Verify health, authenticated access, anonymous rejection, project/task data, CSRF protection, and existing credentials. No administrator or synthetic account is created by this upgrade.

## Recovery

Restore the archive into a separate empty PostgreSQL database first, using `pg_restore --no-owner --no-acl --exit-on-error --single-transaction` with that target's private connection environment. Restore the matching encryption key and validate counts, relationships, authentication and application behavior. Archive readability alone is not evidence of a successful restore.

If a release fails validation, preserve the failed state and any new writes before restoring a compatible release/database pair. Do not run an older SQLite application against PostgreSQL, or resume the old SQLite file after PostgreSQL has accepted new writes. Such a switch would omit the new data. Reconcile later writes before replacing a live database.

<a id="planning-compatibility"></a>

## Planning data and Gantt feature rollback

Task JSON may now contain `scheduleStart`, `scheduleEnd`, `milestone` and `dependencies`. Snapshot/export version3 retains these fields; versions2 and3 require catalogs. Legacy version1/2 whole-workspace replacement deliberately clears planning fields and shows a preview warning. This is separate from restoring an older activity: omitted historical fields retain their current values, while explicit null/false/empty arrays are restored as saved.

Prefer disabling the Gantt entry with `VITE_ENABLE_GANTT=0 npm run build`, deploying that frontend together with the current compatible backend. This build-time flag hides both collection entries and falls back to the list for old Gantt links/defaults. It does not rewrite preferences, task JSON or export formats. Detail editors and the server continue to understand planning fields. Removing the flag and rebuilding restores the entry.

Do not run an older application against planning data as a feature rollback. An older full-task writer can strip JSON fields even when it opens the database successfully. If a binary/database rollback becomes necessary, stop writes, make and verify a private consistent backup through the PostgreSQL backup command, preserve post-backup changes for reconciliation, and restore the matching release/database pair using the procedure above. Restoring an earlier backup loses later writes unless they are reconciled; do not silently discard them. JSON exports alone do not replace the private database and credential/file backup procedure.

`tests/integration/schedule-upgrade.test.ts` checks legacy task JSON compatibility using an isolated PostgreSQL schema. PostgreSQL archive readability and a separate restore rehearsal have distinct results; neither historical SQLite tests nor a passing type check prove production recovery.
