# Executed verification

## Bounded filter optimization and plan closeout (2026-10-13)

[Performance methods, unchanged fixture hashes, all three raw runs and diagnostic limitations](filter-performance.md). [Three-month plan status, explicitly unimplemented items and minimum next inputs](plan-closeout.md). This batch caches the overview work scope and bounded locale formatters. Independent instrumentation reduced Date construction per narrow/reset from 35,002/35,234 to 1/233, and Intl construction during reset from 313 number/200 date formatters to zero. It does not cache user values or alter full-list rendering, leaf-task totals, search results, authentication or collaboration writes.

**310 unit/API tests across 29 files passed**, including locale/option/timezone switching and cache eviction/error semantics. Vue/API typecheck and compiled build passed. **22 related Chromium E2E passed together (2.2 minutes)**, covering preferences, theme/language persistence, weekly changes, navigation, workspace timezone/export and model-observability mocks. No real model was called.

**Eight additional compiled 200-project/5,000-task combinations passed**: EN/中文 × dark/light × 1536/390px. Exact full/partial/combined-filter project IDs, empty state, keyboard reset, sorting, today counts, last-row keyboard expansion and returned focus, scoped axe and no page overflow all passed; zero unexpected browser errors. The initial harness incorrectly used visible collapse text instead of the existing accessible name and was corrected. The next run exposed a real 18px overflow on English 390px with larger status counts; narrow-screen wrapping fixed it, followed by all eight passing. No desktop timing logic or desktop applicable style changed for that fix. [Raw correctness results](evidence/filter-correctness.json).

Four final screenshots were actually opened for visual inspection: [English dark desktop](screenshots/scale-filter-desktop.png), [English dark 390px with wrapped totals](screenshots/scale-filter-mobile.png), [Chinese dark desktop](screenshots/scale-filter-zh-desktop.png), [Chinese light 390px](screenshots/scale-filter-zh-mobile.png). They show the synthetic 200/5000 capacity dataset, not the default 20/150 demo. Scoped axe and Chromium viewports do not substitute for manual screen-reader or physical-device checks; original Library pixels remain unavailable.

In the same unchanged local benchmark, freshly measured baseline filter p95 was **783.1ms** (the previous batch's historical value was 617.0ms). After optimization two complete runs were **280.4ms and 363.1ms**, both still above **200ms**. First-screen p95 was 1050.2/1155.1ms and polling sync 19967.7/19958.5ms. All samples, maxima and narrow/reset subgroups remain recorded; the second run's slower snapshot samples also expose host noise. A diagnostic-only CSS containment probe was not shipped. The batch stops here with explicit row mounting/layout and architecture tradeoffs, not an invented performance pass.

Final lint, formatting and diff checks passed before commit. Draft PR #1's exact-commit CI runs the complete **89 E2E**, 310 unit/API, runtime/proxy smoke and independent reliability job (20 concurrent/offline groups plus scale timing and the eight new correctness combinations). This paragraph describes CI coverage, not an assertion that an unobserved future run passed; the PR links the actual final run and artifacts after completion. No deployment, merge, real data/account change, paid AI or audio service was performed.

## Collaboration reliability and measured scale (2026-10-13)

[Methods, raw samples, final screenshots and remaining real-environment steps](reliability-acceptance.md). **308 unit/API tests across 29 files passed**, including a reproduced-then-fixed metering loss for truncated model output, exhausted/expired allowance and idempotent failed-response coverage. The provider is mocked; no real credential, model request or usage bill exists. Unknown costs remain unknown and invalid suggestions are still rejected.

**Five independent accounts and browser Cookie jars completed all 20 concurrent/offline groups** against a private compiled HTTP/SQLite fixture. The suite drops responses after the real server handles all five simultaneous edits, makes each browser offline for another attempt, then restores connectivity and retries with the original keys. One acknowledged update and four explicit conflicts per group preserve drafts; concurrent duplicate task creation returns identical entities. Final database/snapshot assertions confirm 20 project updates, 100 tasks and 120 audit records, zero unexpected browser errors. Authentication, CSRF, versions and rate limits are unchanged; synthetic traffic is paced within the existing limit. No collaboration write-path fix was needed.

**22 related Chromium E2E passed together**: the eight new administrator language/theme/viewport combinations, existing preference/home interactions and timezone cases. Inspection showed the narrow log table's usage columns require horizontal scrolling, so four mobile cases were extended with keyboard-scroll checks and passed again (20.5 seconds). axe, no external requests, no unexpected console errors and no page overflow passed; four selected screenshots were opened for inspection. Logs in those administrator screenshots are clearly documented synthetic HTTP fixtures, not provider activity.

The compiled 200-project/5,000-leaf-task benchmark passed data and functional assertions and saved all samples. Local p95 changed from **4269.2→1918.1 ms first screen**, **3606.6→617.0 ms filtering**, and **22263.3→19934.3 ms normal polling sync**. First screen and sync meet the local 3000/25000 ms targets; **filtering still misses 200 ms**. The report includes narrow/reset subgroups, a separate CDP diagnostic, sample correlations, payload size and environment. It does not turn loopback measurements into a production SLA. The optimization caches project task groups/summaries and computes timezone boundaries once per statistics call, retaining leaf-task/calendar semantics.

Lint, formatting, Vue/API typecheck, build and diff checks passed. The initial benchmark's incorrect sync selector invalidated that attempt; only its corrected complete rerun supplies baseline evidence. An initial regression test correctly failed because truncated-response tokens were null. Script formatting failures were corrected before final checks. The final exact-commit CI in Draft PR #1 runs all **89 E2E**, 308 unit/API and the new independent reliability job; local targeted passes are not represented as the full suite.

No new dependencies, migrations, live data/accounts, deployment, merge, model activation, paid call or in-app transcription were introduced. Real iOS/Safari, hosted HTTPS/CSP and network faults, production concurrency/scale/soak, real AI credentials/call quality and original Library image fidelity remain outside verified acceptance.

## Contextual text intake and final timezone regression (2026-10-13)

[Text rules, provenance, 50 synthetic scenarios and final screenshots](intake-context.md). **305 unit/API tests across 29 files passed in the final sequential run**. The fixed 50-case corpus passed candidate counts/targets, unknown and conflicting fields, aliases, date handling, exact source/context, transaction plans and undo. Separate API coverage rejects unconfirmed ambiguous targets atomically, retries idempotently, preserves existing projects and protects later task edits. Draft recovery retains match evidence/context but resets confirmations. This is deterministic rule regression, not a live-model or general natural-language accuracy claim.

**All 20 related Chromium cases passed together (2.1 minutes, no retries)**: 1536px/390px contextual intake, ambiguity confirmation, actual saved data/source and undo, original text/CSV/XLSX intake, draft/account recovery, timezone boundaries, actual filtered export downloads and member/admin settings. Visual review then found the original unresolved-target hint remained after choosing a target; the UI now describes the selected target correctly while retaining source ambiguity. Both final desktop/390px review scenarios passed again, including axe, source/draft recovery, no unexpected console errors and zero demo API requests. Final screenshots were opened for pixel inspection.

Lint, formatting, Vue/API typecheck and build passed. The final compiled runtime smoke passed with **zero unexpected browser errors**; local proxy replay also passed with zero unexpected errors before the final wording-only review adjustment. Earlier parallel local runs experienced a 15-second unit timeout and page-load/axe timeouts while typechecking and browsers competed for resources; sequential checks passed without relaxing those thresholds. An earlier source edit also triggered development hot reload during XLSX review; the frozen-source suite passed. Initial exact-label test selectors were replaced with the controls' accessible combobox roles.

The standalone timezone commit `89980e3910a5fedef711a772073cb26dba9c63ac` ran [Verify #32](https://github.com/callmenova1983/project-manage/actions/runs/38441372035): 249 unit/API and 78/79 browser cases passed, with the member setting assertion failing after a login whose response was not checked. The test client now checks login and cleanup status and respects a server-provided HTTP 429 Retry-After window; production authentication and rate limits are unchanged. The complete final **81-case** suite is verified by the final exact-commit CI linked in Draft PR #1, not inferred from targeted local passes. CI artifact transfer to this executor returned proxy CONNECT 403; raw job logs remained readable through the authorized connector. No alternative network route was used.

The only schema change in these batches remains migration 007; contextual intake adds backward-compatible optional JSON fields. No real workspace timezone/data/accounts, credentials, provider requests, deployment or merge were changed. Local HTTP and simulated-proxy checks do not establish production HTTPS/CSP or real-device acceptance. Complex implicit semantics, in-app recording/transcription, production/scale/soak and reference-image pixel fidelity remain unverified or outside the implementation scope.

## Configurable workspace time zone and consistent history export (2026-10-13)

[Semantics, APIs, upgrade/rollback and six final screenshots](workspace-time-zone.md). **249 unit/API tests across 28 files passed**. New coverage includes Asia/Shanghai Monday midnight, UTC compatibility, New York and London DST, Lord Howe half-hour DST, date-only preservation, unified task scopes, versioned admin settings, cross-tab conflicts, same-checkpoint history export, the 10,000-event explicit limit, destination-safe imports and synthetic v6→v7 backup/restart/restore. Lint, formatting, Vue/API typecheck, build and diff checks passed. Compiled-runtime and local proxy replay both passed with **zero unexpected browser errors**.

The complete local browser run passed **78 of 79 cases**. The one failure was in the new test: after cancelling route departure it left the modal sidebar open, which correctly intercepted later clicks. The test now explicitly closes the menu; **all four timezone browser cases passed together** on rerun (1.1 minutes, no retries). They exercise 1536px/390px, explicit save/cancel, admin/member access, weekly boundary totals, repeated pagination, downloaded JSON and insertion cutoffs, local conflict/draft retention, explicit reload and route cancellation. Settings axe checks and overflow assertions passed. The exact-commit CI linked in Draft PR #1 runs the entire final 79-case suite again; a targeted rerun is not described as a full local pass.

Six screenshots were captured from the running app and actually opened for inspection. The source records are synthetic. Existing UTC settings, calendar date labels and instant timestamps remain unchanged until an administrator explicitly changes the shared setting. Migration 007 adds two workspace columns only. No real database/account/timezone, model connection, deployment or merge was changed. Runtime smoke remains local HTTP and proxy replay remains simulated; real production/device/scale/soak and reference-image pixel acceptance remain unverified. The sections below record earlier checkpoints and their then-current boundaries.

## Complete weekly history and stable member links (2026-10-13)

[Implementation, semantics, migration/rollback and six final screenshots](history-members.md). **226 unit/API cases across 26 files passed**, including 11 new cases for complete database ranges, tied timestamps and insertion cutoffs, UTC offsets/week boundaries, workspace isolation, stable IDs, duplicate names, rename/disable, legacy clients, atomic imports, local persistence and v5 backup/upgrade/index rollback. Lint, formatting, Vue/API typecheck, build and diff checks passed. Compiled-runtime smoke and local proxy replay passed with **zero unexpected browser errors**, retaining the prior local-HTTP/simulated-proxy boundaries.

The first full 75-case local browser run passed 74; an existing fault-injection test failed to intercept the development entry module after Vite added a cache query parameter, so the application loaded normally instead of displaying the intentional failure state. The test now matches the exact URL pathname and asserts the abort occurred. All **seven history/member and entry-recovery cases passed together** after correction, including desktop/390px, repeated pagination, old links, search/empty results, duplicate member selection, rename/disable retention, cancel/reload, zero demo API requests and axe scans of the member editor. The final complete suite is verified again by the exact-commit CI linked in draft PR #1; these pre-commit checkpoints do not substitute for that result.

Desktop and narrow screenshots were actually opened, including 620 historical changes that are absent from the latest-500 snapshot, complete totals with paged details, and retained disabled-member assignments. Only synthetic data and `example.test` addresses appear. Migration 006 adds an index only; JSON member fields are optional and legacy names are not auto-linked. No real database, credentials, user access, deployment or live AI was changed. UTC remains the explicit fixed timezone; real device, live production, scale/soak and source-reference pixel acceptance remain unverified. Earlier sections below are historical checkpoints.

## Entry delivery and shared-data recovery (2026-10-13)

Latest increment: [implementation, diagnostic commands, backup/restore runbook and limits](runtime-entry-recovery.md). **215 unit/API tests across 24 files and the complete 71-case Chromium E2E suite passed locally**; the browser run used one worker, no retries and took 6.5 minutes. Lint, Vue/API typecheck, formatting, build and diff checks passed. This increment adds 14 unit/API cases and three browser cases. After tightening the backup public-directory guard, its two integration cases and the compiled build/runtime smoke passed again.

New coverage verifies real HTML GET/HEAD responses, MIME/cache rules, missing-resource 404s, missing/empty build rejection before database initialization, credential-free entry diagnostics, WAL-consistent private backups and independent restore. Two independently logged-in members share a real SQLite-backed workspace; online/foreground refresh preserves dirty mobile edits, and a stale save returns 409 without overwriting the other member. Disabled JavaScript and a failed entry module retain a keyboard-usable native reload link, which recovers after the module becomes available.

The compiled-runtime smoke passed static delivery, the actual XLSX worker, authentication, two-member sharing, demo isolation, process restart, live-database backup and a separate restored instance. The restored snapshot excludes a write made after the backup; the original database retains that later write across restart. The entry diagnostic passed for desktop and mobile User-Agents, and both runtime and local Codespaces proxy-replay reports recorded **zero unexpected browser errors**. Evidence: `artifacts/entry-response.json`, `artifacts/built-runtime.json`, `artifacts/codespaces-browser.json`. The runtime smoke uses local HTTP and synthetic accounts; the proxy replay is intercepted locally. Neither establishes live production HTTPS/CSP or physical-device acceptance. Earlier descriptions of the runtime smoke as testing the XLSX worker under production CSP have been corrected below.

Final [dark desktop](screenshots/runtime-dark-desktop.png), [mobile entry fallback](screenshots/runtime-entry-mobile.png) and [mobile shared-edit conflict](screenshots/runtime-shared-mobile.png) screenshots were captured from the running app and opened for visual inspection. The conflict screenshot intentionally includes additional synthetic projects created during the shared API suite, so its live totals differ from the untouched 20-project seed. Reference-image fidelity is not newly accepted; this executor still could not obtain the supplied source pixels through the supported Library path.

The existing Codespaces origin could not be reached from this execution environment: its configured proxy returned `CONNECT tunnel failed, response 403` before an application HTTP response. No restriction was bypassed. Actual iOS 0 KB behavior, host sleep/resume, a deployed multi-device session, production CSP worker behavior, real AI calls and container execution remain unverified. No migration, real-account change, deployment or merge was performed. Exact-commit CI is linked from draft PR #1; previous checkpoint counts below are historical, not evidence for the current commit.

## Task feedback and mobile navigation (2026-10-12)

Current increment: [behavior, final screenshots and limits](interaction-feedback.md). **201 unit/API tests across 21 files and the full 68-case Chromium E2E suite passed locally.** Lint, Vue/API typecheck, formatting, build and diff checks passed. Compiled-runtime smoke passed authentication, routing, the compiled XLSX worker on local HTTP, isolated demo persistence and process restart with zero unexpected browser errors. Local Codespaces proxy replay passed origin/referer handling, secure session and CSRF save/reload with zero unexpected errors; this remains a simulation, not a deployment test.

Ten new unit cases and seven new E2E cases verify acknowledged completion, real weekly history, version-protected undo, later edits, failed requests/retry identity, late snapshots, account reset, mobile collapse/cancel/focus/Back, all-project reachability, planned-work date semantics, card selection/scrolling, empty state and intake draft recovery. The full run also includes existing 375/390px editing flows and all eight locale/theme/viewport preference combinations. An initial full run exposed save double-click fall-through into a project link; after fixing repeated pointer activation, the affected 11 cases and then the complete 68 cases passed. Final source checks and runtime smokes were rerun after that correction.

Six new synthetic screenshots were captured and opened for visual inspection; settled light-theme and upcoming-work accessibility scans passed. Four supplied phone references could not be downloaded through the supported Library flow, so this executor has not inspected their pixels. Functional implementation was explicitly authorized from parent-supplied descriptions; no reference-fidelity acceptance is claimed. Actual Safari/iOS, the reported 0 KB issue, Codespaces sleep, real multi-person deployment and real model calls remain unverified. There is no schema migration or deployment in this increment. Exact-commit CI is linked in draft PR #1.

The following sections are historical checkpoints.

## M1 connection and intake recovery (2026-10-11)

Current increment: [M1 implementation, before/after screenshots and limits](m1-recovery.md). Lint, typecheck, format, build and compiled runtime smoke passed; 191 unit/API tests passed. The full local 60-case E2E run passed, then the final 8-case recovery suite passed after adding account-switch recovery and narrowing expected HTTP-error filtering. The final suite has 61 cases; exact-commit CI evidence is linked in the draft PR. The three-month plan is [2026-10-12 through 2027-01-11](improvement-plan.md). Codespaces sleep, real iOS 0 KB and real model evaluation remain unverified/unresolved; this increment was not deployed.

The following sections are historical checkpoints.

## Progressive capture and final administration delivery (2026-10-11)

Minimal project/task drafts can be saved before client, owner, date or stage is known. Unresolved tasks use a flagged inbox excluded from business-project counts; missing dates are null and stages stay unclassified. Same-name new-project rows fill only missing facts in any row order; conflicting known facts stop the entire batch and identify the field. Standalone tasks can later change project assignment with version and workspace checks. No real provider request was made.

- Lint, Vue/API typecheck, build, formatting and diff checks passed. **179 unit/API tests across 16 files passed**, including synthetic v3→v5 migration, unchanged accounts/projects, consistent SQLite backup and restoration.
- **53 Chromium E2E cases passed in the full local run.** Final screenshot inspection exposed a desktop sticky confirmation panel covering review details; it was moved to normal document flow. All **6 intake cases passed again** with a non-overlap assertion, including minimal-save/later-completion and conflicting-owner correction. Exact-head CI reruns the complete suite.
- The latest compiled runtime smoke passed authentication, routing, the actual compiled XLSX worker on local HTTP, isolated demo persistence, and process-restart persistence with **0 unexpected console errors**. The local browser proxy replay passed the actual intercepted Origin/Referer rewrite, Secure session and CSRF-protected save/reload with **0 unexpected errors**; it is not a live deployment test.
- Final desktop and 375px review screenshots were captured and visually inspected. Missing fields, pending dates/stage, source access and the final confirmation remain readable without overlap. Earlier first-batch dark-list/theme evidence remains in this directory.

Evidence: [desktop draft review](screenshots/progressive-intake-review-desktop.png), [375px draft review](screenshots/progressive-intake-review-mobile.png), [later task completion](screenshots/progressive-intake-completed.png), [upgrade/rollback runbook](upgrade-intake-admin.md). The draft PR links the exact commit and CI. No production deployment, real account modification, administrator initialization or real LLM test occurred. Speech support is keyboard/system dictation into text only; no in-app recording/transcription/audio upload.

The sections below are historical checkpoints, not the current feature boundary.

## Quick intake increment (2026-10-11)

Text, CSV/TSV and XLSX intake now supports editable candidates, header/sheet mapping, explicit ambiguity/duplicate review, atomic creation, per-row provenance and conflict-protected undo. New unit/API coverage includes parser boundaries, alias ambiguity, impossible dates, duplicate and stale checks, transaction rollback, idempotency, workspace isolation, changed-entity/dependency protection, and undo after local schema-normalized reload. **146 unit/API tests passed**. The four new Chromium cases passed at desktop/375px and include a real synthetic XLSX workbook, Chinese review, axe scan, original cells, cancellation, unsaved navigation, reload, undo and zero demo API calls.

The full 46-case local suite passed 45; the remaining desktop accessibility scan exceeded its 30-second test budget inside axe. That case passed on its separate rerun (11.4 seconds), and exact-head CI runs the complete suite again. Lint, typecheck, normal build and formatting checks passed. Compiled-runtime smoke passed on local HTTP, including the XLSX worker and confirmed creation, alongside existing demo isolation/auth/restart checks; zero unexpected browser errors. Final execution results are linked from the draft PR; the history below is retained for traceability.

See [Quick intake](quick-intake.md). Migration `004_intake.sql` only adds the receipt table/index. No existing accounts, credentials, provider configuration or production deployment changed. User administration, configurable catalogs and model management are still the next sub-batch, not part of this intake increment.

## Latest increment: bilingual themes and factual project tracking (2026-10-11)

- **135 unit/API tests passed**, 11 files. New coverage exercises locale fallback/interpolation, independent theme preferences and contrast, leaf-task focus, and factual weekly activity (seed exclusion, deduplication, completion transitions, UTC week boundaries, restore/import exclusions).
- The Chromium suite now contains **42 cases**, including eight EN/中文 × dark/light × desktop/375px combinations. The first full local run passed 41 and exposed tablet overflow from visually hidden status labels. The corrected 768/1024px case passed separately; the exact-commit CI runs all 42 together. The tablet regression now also checks that report/work cells stay within their rows and headings remain visible.
- All eight preference combinations check persistence, retained original user content, stage filtering, no page overflow, no unexpected browser errors, zero demo API requests, and initial-view axe WCAG 2/2.1 A/AA scans. Additional cases verify a real local save/completion → weekly history → exact activity anchor, plus task focus and browser Back.
- Lint, Vue/API typecheck, normal production build, formatting and diff checks passed. Built browser smoke passed for login, protected routing, isolated demo save/reload, unchanged formal session/data and process restart persistence. **Zero unexpected console/page errors.**
- The actual Chromium replay of the measured Codespaces Origin/Referer rewrite passed again, including Secure session and CSRF-protected save/reload. It remains a local intercepted simulation, not a live public deployment test.
- Final screenshots were captured from the running application. Desktop, narrow and corrected tablet pixels were inspected. The dense list, default-collapsed sidebar and factual update/work columns remain; optional weekly history and next work expand on demand. No Gantt, calendar or delay dashboard was added.

Evidence: [English dark desktop](screenshots/portfolio-en-dark-1536.png), [Chinese light desktop](screenshots/portfolio-zh-CN-light-1536.png), [Chinese dark mobile](screenshots/portfolio-zh-CN-dark-375.png), [Chinese light mobile](screenshots/portfolio-zh-CN-light-375.png), [weekly history](screenshots/portfolio-changes-desktop.png), [768px tablet](screenshots/portfolio-tablet-768.png), [1024px tablet](screenshots/portfolio-tablet-1024.png). All eight language/theme/size screenshots are versioned in `docs/screenshots`. Runtime evidence is in `artifacts/built-runtime.json` and `artifacts/codespaces-browser.json`.

Scope and deployment notes: [experience update](experience-update.md). No schema migration, account change, real provider call, public deployment or merge was performed. Lightweight project intake, speech recognition, admin roles/user management, configurable catalogs and model administration remain **unimplemented next-batch work**. The previous limitations below still apply unless explicitly superseded here; automated checks are not production-launch approval.

## Latest increment: browser demo and measured proxy compatibility (2026-10-11)

The isolated `/demo/` entry is independently deployable at commit `1e05f36b4fe23fd35c1f8863e497ac366123ec32`. The subsequent proxy change is separate, so demo delivery does not depend on formal login recovery.

- **32 Chromium E2E passed**: existing 28 plus 4 demo cases. Fresh anonymous contexts at 1536/390/375px verified project editing, cancellation, repeat save, task creation/status, reload persistence, route return, local rule suggestions, zero `/api/` requests and no issued session. Returning to the formal workspace still requires login; anonymous workspace API access remains 401.
- **105 unit/API tests passed**, 7 files. Proxy coverage includes explicit deployment opt-in, exact Codespace/port and loopback binding, matching browser Referer, forged/missing/foreign/multiple forwarding values, remote peers, Secure session and CSRF protection. Compatibility responses provide same-origin-only Referer policy; default deployments retain no-referrer.
- Lint, Vue/API typecheck, normal build, format and diff checks passed. No VITE demo flag is needed for `/demo/`; formal routes keep the HTTP adapter.
- Built-runtime browser smoke passed: deep demo routes and save/reload work in the normal build; a browser that already has a formal session neither changes nor clears that session, demo activity leaves the server snapshot identical, and server process restart retains formal data. Zero unexpected console/page errors.
- Actual Chromium replay of the observed Codespaces proxy rewrite passed: production headers, browser-generated Origin/Referer, Secure session, authenticated CSRF save and reload. It uses an in-memory API and synthetic credentials; every browser request is intercepted locally. **This is not a live deployment test.**
- Desktop, 390px and 375px demo screenshots were opened and inspected. No horizontal page overflow; initial-view axe scans report no WCAG 2/2.1 A/AA violations. A fast local-save double-click exposed an implicit row double-click editor; removing that shortcut avoids opening an unrelated project after layout movement. Explicit Edit controls remain.

Evidence: [desktop demo](screenshots/demo-desktop.png), [390px](screenshots/demo-390.png), [375px](screenshots/demo-375.png); `artifacts/built-runtime.json` and `artifacts/codespaces-browser.json`. The selected dark list composition is retained; the demo adds an honest local/synthetic-data notice. Actual public Codespaces verification is delegated to the deployment worker. No user browser/password, real Qwen call, deployment or merge was performed by this implementation worker.

The sections below preserve earlier verification history and limitations; older counts/statuses are superseded by this increment and the exact-head PR CI.

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

## Administration follow-up

Added workspace user lifecycle, one-time activation, stage/category registry, constrained Qwen preferences, safe call metadata and management audit. Validation: lint/typecheck and 158 unit/API tests passed; targeted administration + intake browser suite 9/9 passed. The activation fragment is captured before router initialization; recipient activation removes the fragment, issues no session, then permits normal sign-in. Real provider transport was mocked; no actual Qwen request, real credential, real administrator grant, deployment or merge occurred. Full regression results are recorded in the delivery report/CI.
