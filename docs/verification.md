# Executed verification

Execution environment: Linux x64, Node 24.19.0, npm 11.9.0, system Chromium 154.0.8037.57. Local run date: 2026-10-10. Synthetic workspace only.

| Command/check | Actual result |
|---|---|
| `npm run lint` | Passed, no errors or warnings in final source check |
| `npm run typecheck` | Passed for Vue and API |
| `npm test` | **28 passed**, 3 files (6 domain + 5 local adapter + 17 API integration) (domain, local adapter, real SQLite/API integration) |
| `npm run build` | Passed; Vite client and compiled Node API |
| `npm run test:e2e` | **26 passed** after the mobile extension (18 workspace + 8 mobile cases), 1 worker, approximately 1.5 minutes. Subsequent P2 display refinements are checked by targeted layout regression and the latest PR CI; real Chromium + Vite + Fastify + SQLite |
| `node scripts/smoke-built.mjs` | Passed; compiled API/static routing, real browser login, screenshots, actual process restart persistence; **0 unexpected console/page errors** |
| Desktop axe scan | No WCAG 2 A/AA or 2.1 AA violations reported for the tested initial projects view |
| 390px collapsed/expanded and 768/1024px tablet views | Keyboard controls worked; no document horizontal overflow; tablet table can be scrolled by keyboard |
| `git diff --check` | Passed |
| Docker build | **Not verified: BuildKit dependency install stalled despite retries**, see below |
| Reference-image fidelity / design QA | **Pending re-review** against the parent’s actual reference; this consumer still lacks source bytes; see root `design-qa.md` |

## Coverage

Domain: exact 20/150/90/60 metrics; 24 weekly breakdown and 8-today subset; independent due dates; parent exclusion; duplicate IDs; cycles; cross-project parents; real calendar dates; ambiguous source matching; TSV parsing.

Local adapter: browser persistence across adapter recreation; another-tab version conflict; corrupted storage is not silently reset; report timestamp preservation; grouped meeting updates and stale-batch rollback.

API integration: anonymous rejection, credentials, CSRF, origin, shared team edits, workspace isolation; file-backed persistence across reopen; optimistic versions; idempotent retries and mismatched keys; validation; graph transaction rollback; rejection of direct parent status edits (not database parent-state recomputation); combined filters and changed statistics; confirmed/stale/invalid import; proposal confirmation and overwrite; single apply; provenance; restore conflict; logout/expiration; batch atomicity; migration idempotence; same-project reviewed updates aggregate once; exact whitespace/TSV/Unicode source retention; ordinary edits preserve report metadata; reviewed date source/version/overwrite checks and neighboring-line audit.

E2E: desktop navigation and accessibility; search + stage/owner/discipline filters; empty results; project save, reload, cancel and blocked unsaved navigation; project/task/subtask creation; parent completion; repeated save; TSV review/save; today's/weekly scopes; task cancellation; meeting ambiguity/overwrite; conflict current-value display; JSON download/invalid/cancelled/confirmed import; empty workspace; network failure retaining text and request ID; login/invalid login/logout; mobile keyboard use; switched subtask parent; old-week planned-date cleanup; inline notes exact save/reload/cancel; date source/overwrite review; project-level scope switching; multiple reviewed updates combined once with exact source disclosure; tablet-contained table. Expected 401/409/network errors were explicitly asserted, while unexpected browser errors failed the suite.

Built runtime: starts the compiled entrypoint in a separate process on an ephemeral loopback port, initializes a temporary database and random password, verifies protected APIs and SPA routing, signs in through the built UI, captures several pages, saves through the API, terminates/restarts the process, verifies data and session survived, then cleans up its temporary database.

## Browser artifacts

Images are included in the local delivery archive under `artifacts/` and are Git-ignored:

- `desktop-projects.png` — 1536×1024, built application, first project expanded, nonempty TSV notes, pending date, 2/3 subtasks complete.
- `mobile-projects.png` — 390×844, built application.
- `project-detail.png` — 1536×1024.
- `weekly-tasks.png` — 1536×1024.
- `meeting-review.png` — 1536×1024, explicit rule-assisted review.
- `mobile-expanded.png` — narrow expanded row, full-page capture.
- `desktop-collapsed.png` — 1536×1024, E2E collapsed list.
- `layout-metrics.json` — first project row y=195.25, 45px row height.
- `built-runtime.json` — machine-readable runtime result.

Only synthetic names and notes appear. Traces/auth state/test databases are excluded from the source delivery archive.

## Container limitation

Docker daemon and Node base image were available. Docker configuration was redirected to `/tmp` because the default home path was not writable. Initial direct container network probing returned `EAI_AGAIN`. With existing proxy variables and an ephemeral CA mount, independent `npm view vue version` and `npm pack vue@3.5.43` probes succeeded. However, the original full BuildKit build still stalled in both `npm ci` stages for over 10 minutes and was stopped. A subsequent build using host networking and bounded npm fetch timeout/retry settings also did not complete and was stopped. No TLS verification was disabled, no credentials/certificates were embedded, and no image was deployed. The precise BuildKit install stall remains unresolved; do not attribute the final stall solely to DNS. Final image execution and container restart persistence are **not tested**. Native compiled Node process restart persistence **passed**.

## Library transfer limitation

The current unmodified prepared-upload helper failed at `hosted apps tools/list request failed: network`, before upload preparation or any Library write. It failed with normal, explicitly network-enabled, and approved unsandboxed execution. Separate screenshot Library IDs therefore do not exist yet. The previous Library ZIP version remains an earlier implementation unless a later successful replacement is explicitly reported. Local final artifacts and the new archive are the source of truth for this revision.

## Explicitly unverified

Final reference fidelity re-review, cloud browser preview (control tool unavailable), production HTTPS/cookie behavior in a live reverse proxy, true external multi-person deployment, load/soak tests, multi-instance behavior, Firefox/Safari, assistive-technology manual testing, real mobile devices, SSO/MFA/password recovery, live AI integration, database backup restoration and container image execution.

The working branch was pushed with explicit user authorization and draft PR #1 was created; no merge or deployment was performed. The baseline remote Verify workflow succeeded at commit 3471080ad26ba9e09262e466a028c8eec55f389b; the latest commit status is linked from the PR. These local checks demonstrate functional implementation; they are not a production launch approval.

## Mobile acceptance extension

375px and 390px touch-enabled Chromium scenarios passed (8 cases): factual reports and named tasks; daily/weekly scopes; combined filters; detail/return and activity; long inline notes save/cancel/reload; reduced-height save-button scrolling; menu overlay; task/subtask creation, completion and cancellation; meeting ambiguity/source/overwrite review and cancellation. Primary controls were corrected to at least 44×44 CSS px, the menu gained dialog semantics, inert background and focus management, and notices no longer intercept touches. A duplicate audit-source selector revealed by retaining activity across tests was scoped to the newly opened source event.

The 440px reduced-height check is a layout test, **not an actual iOS software-keyboard test**. iOS Safari, native mobile pickers and physical devices remain unverified. Runtime availability and supported private development options are in `docs/mobile-testing.md`. No phone-accessible preview URL has been created.

## Reference review refinements

Added a readable escaped TSV table alongside the editable exact source, visible task-status names and four-state summary labels, actual UTC date ranges, restored child-task indentation, and blue-purple selected/action colors. Adding the date range exposed tablet toolbar overflow; the toolbar now wraps between 761px and 1100px. The first row remains y=195.25 with 45px desktop rows. Final reference sign-off remains with the parent pixel review, not inferred from successful tests.

## Qwen adapter extension (no live provider calls)

The prior `455b5ef4fa48d537183281a69d4619b20e94652b` reference visual QA was confirmed by the parent reviewer, and its exact-head Verify run `38092554085` succeeded. The additional Qwen code is a separate increment; these earlier approvals do not imply live model acceptance.

For this increment, lint, typecheck, production build, formatting and diff checks passed. All **72 unit/API tests** passed (44 additional assertions/cases over the 28-test baseline) and all **28 Chromium E2E cases** passed (26 baseline + 2 explicitly mocked Qwen workflows). The Qwen tests use synthetic notes, IDs and a nonfunctional synthetic token; injected/intercepted transports prevent any provider network request. Server restart retains AI attempt counts and cached outcomes. Duplicate or invalid model results cannot modify business data. Local-adapter tests confirm no external AI request.

Built native Node runtime was checked with `AI_PROVIDER=rules AI_CALLS_ENABLED=false`: static routing, authenticated Chromium, business-data persistence after process restart and zero unexpected console errors passed (Chromium 154.0.8037.57). Frontend bundle inspection found no server key/endpoint/budget markers or synthetic secret marker. This is a static isolation check, not a general security certification.

`artifacts/qwen-mock-review.png` and `artifacts/qwen-mock-mobile.png` are synthetic browser evidence only. Both desktop and mobile images were visually inspected. These screenshots demonstrate configured UI states using mocked responses; they do not prove real Qwen connectivity. The existing private Site remains a browser-local demo; this work performs no Site operation or deployment.

Still required before a live test: console-confirmed provider, region/Base URL and model access; a rotated credential delivered through an approved backend secret channel; a finite approved request allowance/expiry and provider-side spending control. No conversation credential was retrieved, repeated, saved or used. Actual provider authentication, live response quality/latency, billing, model parameter compatibility and deployed regional processing are unverified. Configuration instructions and primary sources are in `docs/qwen-integration.md`.

## Private terminal password reset extension

Added `npm run user:reset-password -- demo@example.test` for the user to run in their own private Codespace terminal. It hides two entries, requires exact `RESET` confirmation, enforces 14–500 characters, and transactionally updates only the selected account's scrypt hash and deletes its sessions. A login transaction rechecks the verified hash so an old-password login in progress cannot issue a session after reset. No HTTP reset endpoint, default password, credential file or automatic account mutation is added.

Local lint, typecheck, build, format and diff checks passed. All **83 unit/API tests** passed, including **11 new tests** covering actual Linux pseudo-terminal non-echo, repeat-entry mismatch, explicit cancellation, Ctrl+C, password length, pipe/argument rejection, successful login/session revocation, other-account isolation, transaction rollback, stale reset targets and in-flight login races. Only temporary databases and synthetic test accounts/passwords were used. No existing deployment account or credential was read or reset; no user-controlled browser was operated. Actual phone keyboard interaction remains unverified. The exact new commit's remote CI result is recorded in PR Checks; previous 28-case browser validation alone does not establish its result.

## Origin configuration and forwarded-request diagnostic increment

Added strict startup origin validation/canonicalization and regressions for the exact Codespaces test origin. Tests reproduce `Origin not allowed` before credentials, accept the configured browser origin despite an internal Host, retain Secure/HttpOnly cookies and CSRF checks, and reject foreign/null/lookalike origins with forged proxy headers. Optional marked-request diagnostics expose only an explicit sanitized origin/host/protocol allowlist; tests verify cookie, authorization, forwarding IP and Referer path/query secrets are excluded.

The deployment worker separately reported successful origin handling on localhost and rejection via the public forwarding path with the same configured origin. Actual received-header evidence is still required. This increment is diagnostic/configuration hardening, **not yet a verified fix for the forwarding-path login failure**. No password reset, live credential use, user browser operation, broad origin allowlist or proxy trust change was performed.
