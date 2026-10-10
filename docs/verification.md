# Executed verification

Execution environment: Linux x64, Node 24.19.0, npm 11.9.0, system Chromium 154.0.8037.57. Local run date: 2026-10-10. Synthetic workspace only.

| Command/check | Actual result |
|---|---|
| `npm run lint` | Passed, no errors or warnings in final source check |
| `npm run typecheck` | Passed for Vue and API |
| `npm test` | **22 passed**, 3 files (domain, local adapter, real SQLite/API integration) |
| `npm run build` | Passed; Vite client and compiled Node API |
| `npm run test:e2e` | **12 passed**, 1 worker, 1.1 minutes; real Chromium + Vite + Fastify + SQLite |
| `node scripts/smoke-built.mjs` | Passed; compiled API/static routing, real browser login, screenshots, actual process restart persistence; **0 unexpected console/page errors** |
| Desktop axe scan | No WCAG 2 A/AA or 2.1 AA violations reported for the tested initial projects view |
| 390px collapsed/expanded views | Keyboard controls worked; no document horizontal overflow |
| `git diff --check` | Passed |
| Docker build | **Blocked by execution-environment container DNS/network**, see below |
| Reference-image fidelity / design QA | **Blocked** by missing reference bytes; see root `design-qa.md` |

## Coverage

Domain: exact 20/150/90/60 metrics; 24 weekly breakdown and 8-today subset; independent due dates; parent exclusion; duplicate IDs; cycles; cross-project parents; real calendar dates; ambiguous source matching; TSV parsing.

Local adapter: browser persistence across adapter recreation; another-tab version conflict; corrupted storage is not silently reset.

API integration: anonymous rejection, credentials, CSRF, origin, shared team edits, workspace isolation; file-backed persistence across reopen; optimistic versions; idempotent retries and mismatched keys; validation; graph transaction rollback; parent status derivation; combined filters and changed statistics; confirmed/stale/invalid import; proposal confirmation and overwrite; single apply; provenance; restore conflict; logout/expiration; batch atomicity; migration idempotence.

E2E: desktop navigation and accessibility; search + stage/owner/discipline filters; empty results; project save, reload, cancel and blocked unsaved navigation; project/task/subtask creation; parent completion; repeated save; TSV review/save; today's/weekly scopes; task cancellation; meeting ambiguity/overwrite; conflict current-value display; JSON download/invalid/cancelled/confirmed import; empty workspace; network failure retaining text and request ID; login/invalid login/logout; mobile keyboard use. Expected 401/409/network errors were explicitly asserted, while unexpected browser errors failed the suite.

Built runtime: starts the compiled entrypoint in a separate process on an ephemeral loopback port, initializes a temporary database and random password, verifies protected APIs and SPA routing, signs in through the built UI, captures several pages, saves through the API, terminates/restarts the process, verifies data and session survived, then cleans up its temporary database.

## Browser artifacts

Images are included in the local delivery archive under `artifacts/` and are Git-ignored:

- `desktop-projects.png` — 1536×1024, built application, projects overview.
- `mobile-projects.png` — 390×844, built application.
- `project-detail.png` — 1536×1024.
- `weekly-tasks.png` — 1536×1024.
- `meeting-review.png` — 1536×1024, explicit rule-assisted review.
- `mobile-expanded.png` — narrow expanded row, full-page capture.
- `built-runtime.json` — machine-readable runtime result.

Only synthetic names and notes appear. Traces/auth state/test databases are excluded from the source delivery archive.

## Container limitation

Docker daemon and Node base image were available. The initial build could not write Docker's default home configuration, so it was safely redirected to `/tmp`. Dependency installation inside build containers then stalled. Retried using normal proxy build arguments and an optional mounted CA certificate; no certificate was placed in the image or source repository. A separate container registry connectivity probe returned **`TypeError fetch failed EAI_AGAIN`** (DNS lookup failure). The blocked builds were stopped. Therefore neither final image build nor container restart persistence is marked passed. Native compiled Node process restart persistence **did** pass. Dockerfile and local-only Compose instructions are provided for a normal network environment.

## Explicitly unverified

Exact reference fidelity, cloud browser preview (control tool unavailable), remote GitHub Actions run, production HTTPS/cookie behavior in a live reverse proxy, true external multi-person deployment, load/soak tests, multi-instance behavior, Firefox/Safari, assistive-technology manual testing, real mobile devices, SSO/MFA/password recovery, live AI integration, database backup restoration and container image execution.

No production deployment, merge or public branch push was performed. These local checks demonstrate functional implementation; they are not a production launch approval.
