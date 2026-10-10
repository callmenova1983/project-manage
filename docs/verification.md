# Executed verification

Execution environment: Linux x64, Node 24.19.0, npm 11.9.0, system Chromium 154.0.8037.57. Local run date: 2026-10-10. Synthetic workspace only.

| Command/check | Actual result |
|---|---|
| `npm run lint` | Passed, no errors or warnings in final source check |
| `npm run typecheck` | Passed for Vue and API |
| `npm test` | **28 passed**, 3 files (6 domain + 5 local adapter + 17 API integration) (domain, local adapter, real SQLite/API integration) |
| `npm run build` | Passed; Vite client and compiled Node API |
| `npm run test:e2e` | **17 passed**, 1 worker, 1.1 minutes; followed by **3 targeted responsive/accessibility tests passed** after tablet refinements (18 distinct E2E cases total); real Chromium + Vite + Fastify + SQLite |
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

Final reference fidelity re-review, cloud browser preview (control tool unavailable), remote GitHub Actions run, production HTTPS/cookie behavior in a live reverse proxy, true external multi-person deployment, load/soak tests, multi-instance behavior, Firefox/Safari, assistive-technology manual testing, real mobile devices, SSO/MFA/password recovery, live AI integration, database backup restoration and container image execution.

No production deployment, merge or public branch push was performed. These local checks demonstrate functional implementation; they are not a production launch approval.
