# Administration

`/admin` manages workspace users, stages/business categories, model preferences, call metadata and management activity. `/demo/admin` exercises the same UI against isolated local simulation: it never calls management APIs, creates a server session or provisions real credentials.

## First administrator and existing accounts

Migration `005_administration.sql` adds role, account status, activation state and optimistic version columns, plus catalog, settings, activation, management audit and safe model-log tables. Existing accounts remain **active members**. All workspace members retain shared project/task editing. The migration never chooses or upgrades an administrator automatically.

An authorized server operator must explicitly select an existing active account and workspace in their private terminal:

```bash
PM_USER_EMAIL='verified-user@example.test' PM_WORKSPACE_ID='verified-workspace-id' npm run admin:grant
```

Replace both synthetic placeholders with verified values. The command requires both, rejects workspace mismatch and pending accounts, records the management action and revokes the account's existing sessions. Sign in again to see Administration. No password/key is requested by this command, and this implementation worker has not run it on a real account.

## Users and activation

Administrators can create users, edit names/email/access, disable or re-enable accounts and generate activation links for pending users. Ordinary members cannot read or write administration endpoints; users in other workspaces are not addressable. Versions protect stale editing. The last active administrator cannot be disabled or demoted. Disabling, changing access or changing email revokes sessions. Login also rechecks account status after password verification to prevent an intervening disable from issuing a session.

New users have an unusable random password hash and remain pending until they set their own password. Activation links expire after 24 hours, are replaced when a new link is generated, and are consumed once in a transaction. Only the token hash is stored; raw activation tokens are not written into logs or idempotency responses. The link is shown once to the administrator for private handoff. The URL fragment is removed from browser history before the page initializes. Activation issues no login session. **No email is sent or claimed to be sent.** Disabling and then re-enabling a pending user cannot bypass activation.

The demo offers **Simulate activation**. It creates no usable credential or real activation URL. Demo configuration and audit data persist in the browser.

## Stages, business categories and imports

Entries have stable identifiers, bilingual labels, order, a restricted color palette and an archived state. The five original stage IDs remain. The reserved `unclassified` pending value is handled separately and cannot be redefined in the catalog. Add and edit entries, then Save classifications. Archive existing entries instead of deleting them; existing project/history references are retained. New assignments require active entries, while unchanged archived references may be retained during ordinary project editing. Business categories are separate from responsibility and are selectable in project editors and list filters.

New exports use schema version **2**, including the registry. Legacy version 1 imports remain accepted. Import preview validates references and detects registry changes; importing changes to the registry requires administrator access. Existing IDs cannot be removed by an import. A saved catalog increments its own version to reject stale writes. Database migrations do not reset projects, tasks or synthetic seed data.

## Model settings and logs

Administrators can now enter a Model Studio API key in **Model settings → Qwen API key**, with the region, optional approved API endpoint, total attempt allowance and expiry. Saving makes no external request and explicitly leaves calls disabled; enable calls separately through the existing settings. Previously used attempts count against the same workspace allowance even after key replacement. Server-provisioned environment credentials continue to take precedence and cannot be overwritten through this form. Browser demos cannot save real keys.

Migration `009_model_credentials.sql` stores workspace credentials encrypted with AES-256-GCM. The separate encryption key is created on first save beside the configured database as `<database-path>.credentials-key`, with permissions 0600. Back up that key privately together with the database; restoring the database alone cannot recover saved model credentials. The API never returns the submitted secret or writes it to model settings, audit entries or cached mutation responses. The input is cleared after submission; it is not persisted in browser storage. Configuration does not verify actual Qwen connectivity.

The implemented provider adapter remains Qwen `qwen3.6-35b-a3b`; this is not an arbitrary provider/plugin registry. Administrators can save region, credential reference, timeout, output-token limit and enablement. Saving makes **no model call**. The existing `server-default` reference resolves to the server-provisioned credential or the encrypted credential of the current workspace. Keys are accepted only by the dedicated administrator credential endpoint. Normal model-settings requests reject plaintext key fields and arbitrary environment-variable names. With operator-provisioned credentials, workspace settings still cannot increase server limits or change the approved model/region, global attempt budget or expiry.

Calls still originate from the meeting review flow, require explicit external-processing confirmation and produce a draft for review rather than applying changes automatically. This page does not claim connectivity has been verified. No real key was configured and no real model call was performed by this worker.

The latest 100 request logs expose time, actor, provider/model, real/simulated/rules mode, status, total elapsed time, attempt count, error code and provider-reported input/output usage when present. Usage represents the successfully parsed response; retries with missing usage are not estimated. Costs remain unknown. Raw source notes, provider output, request headers and keys are excluded. Prior AI request cache records are not backfilled as usage logs because they do not contain trustworthy measurements. The request/attempt budget continues to persist separately. Demo sample logs are explicitly simulated and never mixed with real provider records.

Management activity is a separate projection containing actor, action, target and time; no credentials or activation links. It displays the latest 100 records. These features do not add SSO, MFA, outbound email, arbitrary model provisioning, real-time push synchronization or production operational approval.
