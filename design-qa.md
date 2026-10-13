# Design QA

final result: blocked — final reference re-review pending

Current functional increment (2026-10-12): [task feedback and mobile navigation](docs/interaction-feedback.md). The user authorized functional implementation from the parent's descriptions after four newer phone-reference downloads failed. Local application screenshots were inspected, but this executor still makes no source-pixel fidelity claim. The historical reference gate below is not changed to passed.

## Reference acquisition blocker

- Exact selected target: Library `libfile_f7e6060569e48191b8d47ecc87e31074`, version **2**; reported source pixels **1536 × 1024**. The requested current design contains Latest reported update, This week's work, This week summary.
- Consumer destination: `/workspace/reference/latest-dark-v2.png`.
- Used the current Library skill, its resolved-reference materialization procedure and unmodified transfer helper. Preparation returned the correct version. Initial transfer and one supported retry both returned **`library file transfer failed: download failed`**. No readable source image exists at the destination. No signed URLs are recorded in this report.
- Source visual truth path: unavailable. Source pixels have **not** been visually inspected. This is not a reference-faithful visual acceptance claim.
- The implementation proceeds as the authorized independent engineering work using the explicit written product requirements. It must be compared and refined once the actual pixels are delivered.

## Rendered evidence

- `artifacts/desktop-projects.png`: Chromium-rendered `/projects`, authenticated synthetic data, dark theme, sidebar collapsed. CSS viewport **1536 × 1024**, image **1536 × 1024**, deviceScaleFactor **1**.
- `artifacts/mobile-projects.png`: CSS viewport **390 × 844**, same dark route, scale **1**, image **390 × 844**.
- `artifacts/mobile-expanded.png`: narrow filtered/expanded project state, full-page image (not equivalent to the desktop reference state).
- The actual screenshots have been opened and visually inspected. Reference and implementation could not be put into one comparison input because the source is missing. Full-view reference comparison and focused typography/table comparisons are therefore **blocked**, not skipped as unnecessary.
- System Chromium was available and used by the application’s Playwright test suite. Browser skill was read; the required cloud-browser Node REPL control tool was absent from the available/discoverable tool list. No claim is made that the cloud browser preview was opened.

## Required fidelity surfaces

| Surface | Current implementation check | Reference comparison |
|---|---|---|
| Typography | Locally bundled Inter, hierarchy and truncation inspected | Blocked: source unavailable |
| Spacing/layout | Desktop list, default closed overlay menu and horizontal navigation; narrow cards with no document overflow | Blocked |
| Colors/tokens | Blue-black surfaces; accessible controls; corrected small metadata contrast | Blocked |
| Assets | Phosphor icon library and text initials; no reference raster used as the UI | Cannot catalog source imagery without source pixels |
| Copy/content | Latest reported update / This week's work / This week summary; rule-assisted disclosure; real computed counts | Structural brief checked, source copy fidelity blocked |

## Implementation QA history

These are product/browser corrections, **not** visual-match iterations:

1. Initial Chromium/axe pass found metadata/footer contrast below 4.5:1. Raised text colors (`#8b93a5`, `#8791a4`); subsequent desktop WCAG 2 A/AA and 2.1 AA automated scan reported zero violations.
2. Initial browser console captured favicon 404. Added an explicit empty favicon to avoid missing resource requests. Subsequent E2E reports no unexpected console/page errors.
3. Inline closure review found unsaved state could be lost by row collapse. Added shared unsaved checks and explicit editor cancellation; route-return/cancel E2E passed.
4. Narrow view condensed the metrics into four small counts and a work-scope row. Both collapsed and expanded states tested at 390px without horizontal page overflow. This initial KPI layout was superseded by the compact list below.

## Interactions actually tested

Authenticated Web → real Fastify API → SQLite: search and combined filters; empty state; route to project and back; inline edit/save/reload; cancellation; unsaved navigation; create project/task/subtask; parent completion counts derived from leaves; status update; TSV preview and save; repeated save; today/week views; source review, ambiguity and replacement confirmation; stale edit and current version display; export; invalid/cancelled/confirmed imports; network failure with draft preservation and stable retry identity; login/invalid credentials/logout; keyboard expansion; narrow screens. Exact pass counts are in `docs/verification.md`.

## Required next step

Deliver the readable exact version-2 reference into this consumer environment. Open its pixels; create a same-viewport combined source/implementation comparison; inspect focused typography and table regions; fix all P0/P1/P2 differences and capture again. Only then may `final result` become `passed`. No approval is required for this already-authorized work, but the source bytes are currently missing.

## Follow-up reference feedback and implemented corrections

The parent independently opened the actual version-2 reference and supplied concrete findings: reference header y≈161, first project y≈190, 40–48px collapsed rows and approximately 14 projects with an expanded row. This consumer has not claimed to see unavailable source pixels.

- Replaced tall KPI cards and persistent icon rail with horizontal brand/navigation, one-line totals, work-scope controls and dense rows. Actual first row **y=195.25**, **45px** height at **1536×1024**, approximately 14 projects visible with the first row expanded.
- Today / This week now changes named tasks with status shapes and each project's four-state summary in place. Owner is not a substitute for work content.
- Independent `reportedAt` and `reportedBy`; ordinary property/notes edits do not become reports. Legacy unknown time remains unknown.
- Editable original notes and subtasks appear in two columns on desktop and stack on narrow screens. Final same-state screenshot includes nonempty TSV notes, a pending date candidate and **2/3** completed subtasks.
- Date review shows neighboring source lines and requires task/date confirmation and an additional overwrite confirmation.
- Project names 16px, factual text 14px, report metadata 12px; mobile names remain readable. Rocket brand, blue-black surfaces, purple actions and distinct lifecycle/status icons.
- 390px first screen now contains the first project's factual report, report time/person and complete named tasks. 768/1024px table is contained in a keyboard-scrollable region.

Final implementation screenshots have been opened and visually inspected. The remaining gate is the parent's same-state source/implementation comparison; no visual pass is claimed without it. All routine verification and the limitations are separately recorded in `docs/verification.md`.

## Final P2 adjustments for parent re-review

Readable TSV tables now render alongside the original editable text; task states and per-project state summaries have visible words; the active scope shows its actual UTC dates; child task indentation is restored with a visual guide; primary buttons and selected scope use blue-purple colors. Mobile primary actions are at least 44px, with touch flows tested at 375px and 390px. The final images are versioned under `docs/screenshots/` for direct GitHub access. These fixes address the five identified P2 findings; the report remains blocked pending the parent's final source-pixel comparison.
