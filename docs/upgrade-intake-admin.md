# Upgrade: intake, progressive drafts and administration

This is an operator runbook, not an executed deployment. Use the delivered exact commit only after its CI succeeds. The implementation worker has not changed the running service, real accounts, credentials or port visibility.

## Preparation

1. Record the currently running commit and its startup method. Prepare a separate release checkout of the delivered commit; run `npm ci` and `npm run build` there with Node 24. Keep `apps/api/migrations` with the built release: migration discovery uses the release working directory.
2. Identify the **existing absolute database path** from the service's private configuration. Keep that same path when changing the release directory; a relative `DATABASE_PATH` can otherwise accidentally create an empty database. Preserve the exact `APP_ORIGIN`, loopback binding, port, authenticated service configuration and existing Codespaces rewrite opt-in. Do not seed, reset, create users or grant an administrator as part of deployment.
3. Keep `AI_PROVIDER=rules` and `AI_CALLS_ENABLED=false` in the service configuration. Do not supply a model key or enable provider calls. Current speech support means entering text with the user's keyboard/system dictation; there is no in-app microphone recording, speech recognition or audio upload.

## Quiesce and create the rollback backup

Stop the existing API using its actual process/service manager and stop other writers. Leave traffic closed through migration and smoke validation. Do not use a broad process-kill command.

In the existing private release directory, export `PM_BACKUP_PATH` to a **new private absolute path outside the repository**. The following reads the configured database, includes committed WAL contents through SQLite's backup API, refuses to overwrite a backup, and verifies it. It does not print database contents or credentials.

```bash
node --input-type=module <<'NODE'
import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, chmodSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
const source = resolve(process.env.DATABASE_PATH ?? './data/project-manage.sqlite');
const target = process.env.PM_BACKUP_PATH;
process.umask(0o077);
if (!target || !isAbsolute(target) || existsSync(target) || !existsSync(source))
  throw new Error('Verify the existing database and a new absolute backup path');
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); } finally { db.close(); }
chmodSync(target, 0o600);
const check = new DatabaseSync(target, { readOnly: true });
try {
  if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      check.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Backup verification failed; keep traffic closed');
} finally { check.close(); }
console.log('Private rollback backup verified');
NODE
```

Provision the backup's parent directory with private permissions first. Record the backup checksum and previous commit in that private location. Preserve the old service configuration through its existing secret mechanism; never place `.env`, database files, hashes, sessions, activation tokens or backups in Git, chat or a public artifact. JSON export is not a complete database backup.

## Migrate and validate before reopening traffic

1. In the new release directory, load the existing service environment with the verified **absolute** `DATABASE_PATH`. Run `node dist/server/apps/api/src/cli.js migrate`. `004_intake.sql` adds intake receipts. `005_administration.sql` adds user account state/role, activation, catalog, model preferences and safe logs. Each migration is transactional and runs once. Existing accounts remain active members; no administrator is selected automatically. Progressive draft values require this new application version but add no migration beyond 005.
2. Check `migrations` has versions 4 and 5 and run `PRAGMA integrity_check` / `PRAGMA foreign_key_check` using a private read-only database connection. Compare workspace/project/task/user counts with the backup; migrations must not create synthetic projects or accounts.
3. Start the new API through the existing service manager with the same verified environment. Verify health, authenticated access using an already-authorized session, anonymous API rejection, project/task data, same-origin/CSRF behavior and isolated `/demo/intake`. Check the model UI reports external calls disabled. Existing members must remain unable to access administration. Do not change a real account merely to smoke-test the new screen.
4. Reopen traffic only after smoke validation. First-administrator initialization is a separate, explicitly authorized operation selecting an existing account and workspace; see [administration.md](administration.md). Do not run `admin:grant`, `user:create` or password reset during this upgrade.

## Rollback

Keep the verified backup and previous release until acceptance. There is no automatic down-migration.

If validation fails before traffic reopens, stop the new service and every writer. Preserve the failed database **and its matching `-wal` / `-shm` files** together in a separate private quarantine directory. Restore the verified backup to the original database path, restore ownership/private permissions, and ensure no stale WAL/SHM remains at that path. Start the previous release with its original environment and recheck integrity, health and authenticated access.

Restore the **old binary and matching pre-upgrade database together**. Running an old binary against the new database is not a supported rollback: older authentication ignores the new disabled/activation state, and older validation does not support pending draft fields. If new writes or account changes have already occurred, restoring the earlier snapshot would lose them; keep traffic closed and reconcile those changes before authorizing a restore. Do not silently discard them.

A synthetic migration/backup test exercises v3 → v5, unchanged user/project data, member defaults, integrity/foreign keys and restoration of the pre-upgrade snapshot. This is not evidence that a particular production backup, storage device or service restart has been tested.

<a id="planning-compatibility"></a>
## Planning data and Gantt feature rollback

Task JSON may now contain `scheduleStart`, `scheduleEnd`, `milestone` and `dependencies`. Snapshot/export version3 retains these fields; versions2 and3 require catalogs. Legacy version1/2 whole-workspace replacement deliberately clears planning fields and shows a preview warning. This is separate from restoring an older activity: omitted historical fields retain their current values, while explicit null/false/empty arrays are restored as saved.

Prefer disabling the Gantt entry with `VITE_ENABLE_GANTT=0 npm run build`, deploying that frontend together with the current compatible backend. This build-time flag hides both collection entries and falls back to the list for old Gantt links/defaults. It does not rewrite preferences, task JSON or export formats. Detail editors and the server continue to understand planning fields. Removing the flag and rebuilding restores the entry.

Do not run an older application against planning data as a feature rollback. An older full-task writer can strip JSON fields even when it opens the database successfully. If a binary/database rollback becomes necessary, stop writes, make and verify a private consistent backup including committed WAL contents through the supported backup command, preserve post-backup changes for reconciliation, and restore the matching release/database pair using the procedure above. Restoring an earlier backup loses later writes unless they are reconciled; do not silently discard them. JSON exports alone do not replace the private database and credential/file backup procedure.

`tests/integration/schedule-upgrade.test.ts` uses an isolated synthetic schema18 database with legacy task JSON and audit records. It checks unchanged existing task values, entity versions, revision and audit data after upgrade; saves planning and dependencies; reopens the database; edits an old-form title without those fields; then verifies a private backup reopened by the current repository matches the source snapshot. This evidence covers the synthetic fixture, not a production restore or an old-binary compatibility guarantee. Browser checks with the Gantt flag disabled and production recovery rehearsal remain separate release gates.
