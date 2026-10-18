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

## Project map QA — 2026-10-16

This is a separate QA record for the project map increment. The historical report and its reference-acquisition gate above remain unchanged.

**Functional verification: passed within the browser demo.** Actual Chrome UI operations confirmed saving Beilun District, Yunhe County and the coordinate point `121.85,29.9`, with Shanghai retained as a city-level fallback. Tour playback advanced from Orbit to Meridian; focusing the location input paused it. Switching co-located Atlas / Meridian changed the position counter between `1/2` and `2/2`, while all four `.earth-label-layer button` transform strings remained exactly unchanged.

**Mobile implementation check: passed.** At an IAB viewport width of 425 px, document `scrollWidth` was 425 and no error logs appeared. The [current full-page mobile screenshot](artifacts/project-map/mobile-current.png) was saved and visually inspected; the legend and tour controls do not overlap. These checks cover the rendered implementation, not fidelity to the desktop reference.

**Static verification: passed.** Node.js 24.19.0 completed `npm run build`; five focused location, API, draft and earth-renderer test files passed all 71 tests. Details and repeatable commands are in [the project map documentation](docs/project-map.md). No production deployment or successful real-model request is claimed.

**Final exact desktop reference comparison: blocked / pending.** The latest attempt to obtain a matching **1743 × 902** Chrome viewport timed out in the viewport tool. A final comparison of the latest implementation at that exact viewport remains outstanding; no latest pixel-perfect claim is made. This is a current viewport-control blocker, distinct from the historical Library reference-download failure documented above.


## Project map first-impression update — 2026-10-17

Scope: approved incremental redesign of the existing map and the user-selected “总部扫描” motion. Historical reference-fidelity gates above are not replaced by this scoped review.

- Source visual truth: `artifacts/project-map/first-impression-audit/01-map-entry.png` and the selected radar variant in `/Users/yuanjiezheng/.codex/visualizations/2026/10/16/01a144b5-6c60-7cb1-b03d-772ba554b180/nearby-project-motion.html`, plus the explicitly approved first-impression changes. This is an intentional redesign, not a pixel clone.
- Final implementation: `artifacts/project-map/first-impression-audit/06-final-entry.png`; mobile: `05-mobile-entry.png`; transition: `07-headquarters-scan.png`.
- Comparison: source and final desktop images were opened together in a single comparison tool response. Both are 1920×1200 image pixels / CSS viewport 1920×1200, same demo route without a project query. IAB reports DPR0.75; its screenshot clip1440×900 produces the full1920×1200 content image. Empty capture padding was excluded at capture, no image resampling. Selection changes from the old first storage item to the first ordered tour item intentionally.
- Full-view review: summary card replaces the expanded locator; headline metrics communicate coverage and stages; project network is larger, with visible Shanghai/Hangzhou/Lishui/Yunhe labels and persistent Ningbo connections. Existing fonts, stage colors, dark surfaces and card-turn behavior retained.
- Focused surfaces: card text, location control, header counts and bottom controls are legible at source resolution; DOM bounds verified for 800px footer and 425px document width. No additional image crop needed.

### Comparison history / fixes

1. P1: first implementation `03-revised-entry.png` still placed the city network in a small area. Fixed projected fit and regional camera tilt.
2. P1: `04-refined-entry.png` enlarged the coarse night texture excessively and inflated HQ/landing geometry. Fixed overview floor0.55 and screen-size compensation: HQ14px, landing ring32–44px. Final `06-final-entry.png` shows a bounded compromise without new raster assets.
3. P2: 800px footer content overlapped despite the container not overflowing. Split controls and stage legend into two rows for761–900px. Actual DOM bounds after fix place them on separate rows;425px full-page capture has no overflow.
4. P2: state review found ready could override a user drag, same-coordinate selection from overview could skip focusing, and a ready-triggered opacity animation could flash an already-visible card. Fixed mode guards, explicit first-focus intent, and transform-only card entrance.

### Required surfaces

- Typography: existing Inter/PingFang fallback retained; city14px and HQ12px improve map labeling, summary14px/1.8; long updates limited to4 lines with details link.
- Spacing/layout: standard entry gives network and compact card space; mobile stacks map/card/rail/footer; intermediate-width footer wraps.
- Colors/tokens: headquarters mint and stage colors retained; background light intensity reduced, basic connections opacity0.6; precision and confirmation have text labels.
- Image quality/assets: existing8K night raster retained. Regional softness remains an acknowledged asset-resolution limitation and a separate follow-up, not a claim of HD imagery. No fabricated map coordinates or image replacements.
- Copy/content: real workspace owner/customer/update data; coverage includes candidates with explanatory tooltip; unlocated projects retained in rail and location-management count. Demo English content is existing synthetic data.

### Verification

Full build passed,50 targeted unit tests passed, scoped ESLint/Prettier and diff checks passed. Browser checks include normal entry, deep link, 5s tour advancing, 2s speed option, editor pause, collapsed location controls and same-coordinate switch with unchanged map label transforms. Browser error log was empty. Reduced-motion and finite-scan behavior covered in renderer tests; client hardware cold-load/FPS not benchmarked.

No outstanding P0/P1/P2 for this approved increment. Follow-up: real regional high-resolution texture, with an explicit loading/memory budget.

final result: passed

### Follow-up: globe-to-headquarters entry — 2026-10-17

User supplied two camera references and requested the default entry advance from the large globe in image 1 to the Ningbo regional view in image 2. Updated only entry camera timing/state, retaining the previous layout and existing imagery. The globe intentionally extends below the footer as in image 1; this is not an all-hemisphere fit.

Verified rendered endpoints at the same desktop viewport: `artifacts/project-map/first-impression-audit/08-entry-zoom-start.png` and `09-entry-zoom-arrived.png`, both opened and inspected. Entry holds 180 ms, advances for 1500 ms, then reveals the finite headquarters sweep and routes. A real browser click on zoom-out during entry entered exploration mode; the interrupted camera remained stable afterward. No new asset or animation dependency was introduced.

54 targeted tests and the full build passed, with scoped ESLint/Prettier and diff checks. New state coverage includes data/resize continuity, one-time entry, manual interruption, explicit overview/project before texture-ready, and reduced motion enabled during entry. Existing desktop/mobile layout findings and imagery-resolution limits remain unchanged.

### Follow-up: English map display — 2026-10-17

Added English map labels and a separate cached translation display layer for project names, customers and progress. Original project data remains unchanged. Names use English terminology/pinyin while translation is pending or unavailable; prose shows an explicit English availability message. Demo mode does not call a real model.

35 targeted tests passed, covering catalog labels, translation validation, caching and scope isolation, authentication, failure handling, original-data preservation and language changes without camera movement. Full build passed. Real provider translation quality is not verified.

Visual verification remains blocked: the controlled in-app browser is stuck on a connection-error data page and automatic approval review rejects interaction with its URL scheme. The local HTTP route returned 200, but this is not visual acceptance. No English screenshot or final visual pass is claimed for this increment.

## AI 工作助手一期增量验收（2026-10-17）

本增量按用户明确的全局侧栏、聊天、手机和统一输入需求实现，不是此前缺失参考图的像素复刻验收；不修改上方历史阻塞结论。桌面及 390×844、390×440 的侧栏/审阅/输入布局已通过 CUA 检查，混合资料分流、恢复、结果导航、撤销与日志归档已验证。详细证据和边界见 [一期验收](docs/assistant-phase-one.md)。手机实际麦克风授权、软键盘和录音仍待用户实测。

## Workspace dashboard — option 2, original navigation retained — 2026-10-17

Scope: implement the selected second concept inside the existing Workspace Overview. The user's subsequent instructions, “菜单布局不要改啊” and “菜单要跟主的一致啊”, explicitly override the concept's sidebar. This increment preserves the original global navigation and Project / Workspace Overview tabs. Historical QA conclusions above are unchanged.

### Visual truth and comparison

- Selected concept: `/Users/yuanjiezheng/.codex/generated_images/01a14a50-b089-7a40-a98c-0f4595d6ab34/exec-cfcf8b32-fe16-4412-9c2a-e362e737d5f0.png`, 1746×901 pixels.
- Final implementation: `artifacts/workbench-dashboard/desktop-final.png`, 1747×901 pixels; full-page evidence: `desktop-full.png`. Mobile evidence: `mobile-first.png` and `mobile-en-dark.png`, 391×844 pixels.
- Desktop CSS viewport: 1747×901. IAB viewport request 1310×676 and matching screenshot clip compensate for the browser's 0.75 density conversion; no image resampling. The 1px source-width difference is rounding. Full-page capture contains extra browser-generated canvas padding; that padding is not application overflow and is not used to judge proportions.
- Source and final desktop screenshots were opened together in one comparison tool response. Both show the full current week in the light theme with filters closed and no task dialog. The concept's illustrative 10 tasks differ intentionally from the existing demo store's 24 tasks; figures and records were not fabricated to match the image. Actual authenticated workspace data were not inspected.
- Full view confirms the summary strip, wider weekly task column, narrower all-date risk column, blue group headers and warm risk accents. Original top navigation and the existing demo notice add vertical space relative to the concept. Completed rows, latest reports and unplanned work remain reachable by normal scrolling and were inspected in the full-page capture.
- The table text, dates, status markers, action controls and navigation are readable at the comparison images' native size; additional detail crops were unnecessary.

### Findings and fixes

1. P1, navigation: the initial shell followed the concept's sidebar. After the user's correction, all shell changes from this task were reverted. `App.vue` content hash is `939b77707ae6cecabda5b1333ea20dd1dbfcb1f1`, identical to the task-start copy; `ProjectHomeView.vue` retains unconditional original tabs. Final desktop evidence confirms the shared top navigation.
2. P2, layout density: inherited label layout stacked the scope control, and repeated table headers / larger rows pushed key groups downward. Scope direction is explicitly horizontal; summary and rows are compact; repeated headers remain accessible but visually hidden in secondary groups; scheduled and undated show-more controls are in group headers. `desktop-final.png` is the post-fix comparison.
3. P2, data consistency: assignees now resolve current member names through the existing member helper. Empty-project drilldowns preserve an empty project selection. Task grouping uses work dates / work week separately from due dates, and all-date risks remain independent of the selected day or work scope.
4. P2, focus continuity: closing a dialog after a task moves out of its original group has a stable fallback at the scope selector. This correction passed type checking and code review; disappearance-specific keyboard focus behavior was not separately browser-tested.

No outstanding actionable P0/P1/P2 visual findings for this scoped increment. Original menu placement, existing brand tokens, live-store counts and additional report rows are intentional differences from the concept.

### Required fidelity surfaces

- Typography: retained existing Inter / Chinese system fallbacks; clear heading, KPI and row hierarchy. Main task text is 14px; secondary dates are smaller, with distinct accessible due/work-date labels. Long text truncates inside bounded cells.
- Spacing/layout: compact single-row summary, approximately 64/36 two-column layout, consistent card padding and section gaps; mobile stacks the columns and uses card-like task rows. At 391px, document width equals scroll width.
- Colors/tokens: existing light/dark semantic tokens and brand blue retained; overdue red, blocked amber and completed green have accompanying words or icons. No color-only task status.
- Assets: existing rocket logo and installed icon library reused; no new raster assets or approximate logo drawings required by this data interface.
- Copy/content: interface strings are localized; records and names come from the current store. Existing English demo task names are user-data examples, not untranslated interface labels. “本周待定日期” and all-date “未安排” retain different meanings.

### Verification and remaining boundaries

- Full production build and scoped ESLint passed. Four focused test files passed all 39 tests (workbench grouping, project view, task view and multi-view contract).
- Browser demo checks passed: today/week switching; individual work-day filtering; unchanged all-date risks; task detail; completion and undo; assigning a work date and restoring it; scoped risk drilldown; empty project filters; show-more; Chinese light and English dark mobile layouts. Synthetic task changes were restored after checking.
- A fresh final reload produced no new browser errors. An earlier temporary dynamic-import error from an intermediate template edit remains in historical tab logs and was fixed before final verification.
- The broad interface-localization check found untranslated strings in unrelated `StatisticsView.vue` / `StatisticsDetails.vue`; those concurrent files were outside this task and were not changed. This is not a claim that the repository's full suite passes.
- The authenticated route displays sign-in in the controlled browser. Browser functional evidence is from `/demo/projects?tab=overview`; no shared-backend or production verification is claimed.

Implementation checklist complete for the selected dashboard content and original-menu constraint. No additional deployment was requested or performed.

final result: passed
