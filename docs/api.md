# API contract

All routes use `/api`. JSON responses. `/health` and `/auth/login` are public; every other route requires the HttpOnly session cookie. POST/PUT additionally require `x-csrf-token` from login/session. Domain mutations require UUID `idempotency-key`. Same key + same payload replays the original response for seven days; a different payload returns 409. Workspace identity is always taken from the authenticated user, never client input.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Process health (no workspace data) |
| POST | `/auth/login` | `{email,password}` → `{actor,csrf}` + cookie |
| GET | `/auth/session` | Current `{actor,csrf}` |
| POST | `/auth/logout` | Revoke current session |
| GET | `/workspace` | Consistent projects/tasks/activities/revision snapshot |
| GET | `/projects` | `search`, `stage`, `owner`, `discipline` combined filters |
| GET | `/projects/:id` | One project in current workspace |
| POST | `/projects` | Validated ProjectInput; server ID and version |
| PUT | `/projects/:id` | ProjectInput + expected `version` |
| GET | `/tasks` | `projectId`, `status`, `week`, `day`, `search` combined filters |
| POST | `/tasks` | TaskInput; valid same-workspace project and parent |
| POST | `/tasks/batch` | `{tasks:TaskInput[]}` 1–100, atomic paste |
| PUT | `/tasks/:id` | TaskInput + expected `version`; no project moves |
| GET | `/activities` | Latest 500 audit events, newest first |
| POST | `/activities/:id/restore` | `{version}`; restore before-value with conflict check and new audit |
| GET | `/export` | Snapshot JSON; recent activity only |
| POST | `/import` | `{schemaVersion:1,projects,tasks,revision,confirmed:true}` |
| POST | `/proposals` | `{source}` → immutable original source + rule suggestions |
| GET | `/ai/capabilities` | Configured provider/model/region and remaining attempts; no key/endpoint, no connectivity claim |
| POST | `/proposals/qwen` | `{source,externalProcessingConfirmed:true}` → source-backed model draft; disabled without approved server configuration |
| POST | `/proposals/:id/apply` | Explicit reviewed suggestions, atomic, single application |

Payload types and limits are authoritative in `packages/domain/types.ts`. Notes max 20,000 characters; imports/body max 2 MB; 1,000 projects and 10,000 task records; nesting max 20 levels. Import replaces project/task sets but keeps audit history and increases versions. Create/update timestamps and IDs are generated server-side. Text is rendered as text, never executed as HTML.

Meeting apply sends `id`, `selectedProjectId`, `title`, `action` (`task`/`update`), `status`, `confirmed:true`, `overwriteConfirmed`; update requires `projectVersion`. Each selected item must match a line in the persisted source. Application does not delete or merge records and does not call a model. Only the separately configured `/proposals/qwen` generation route can contact Qwen.

Qwen generation requires a UUID idempotency key, authentication, CSRF and explicit external-processing consent. Its separate persistent idempotency ledger also stores terminal failures; retries with the same key never incur another provider call. Pending/interrupted requests return 409. Budget/rate limits return 429; invalid provider output 502; disabled/configuration/provider errors 503; uncertain timeout/network failures 504. Sanitized `AI_*` codes never include vendor bodies or secrets. See [Qwen integration](qwen-integration.md) for limits and activation requirements.

Errors: 400 invalid input; 401 unauthenticated; 403 origin/CSRF mismatch; 404 inaccessible or missing record; 409 stale version, idempotency mismatch or applied proposal; 429 rate limit; 500 generic internal error. Version conflicts return the latest same-workspace record in `current`. Zod errors provide `issues` with paths. SQL is parameterized; audit and mutation share one transaction.

The web adapter retains an idempotency key across ambiguous network failures until a definite response arrives. Cancel performs no mutation. Authentication rate limit: 10 attempts/min/IP; general API limit: 300/min/IP. Reverse proxy trust is disabled; production proxy/rate-limit design requires explicit deployment review.

## Report metadata and reviewed dates

`reportedAt` / `reportedBy` belong to the latest factual report; ordinary notes/owner/stage edits leave them unchanged. Legacy records without an attributable report retain null metadata. Confirmed meeting updates for one project are combined into one version with all source lines recorded. Proposal source text is stored verbatim; parsing retains original line offsets.

`POST /api/projects/:id/note-dates` accepts `projectVersion`, `sourceLine`, `taskId`, `taskVersion`, `dueDate`, `confirmed: true`, `overwriteConfirmed`. The server verifies the saved source candidate, same-project task, both versions and overwrite confirmation; it changes only the task due date and records neighboring source lines in the audit. It does not infer relative dates or change work scope.
