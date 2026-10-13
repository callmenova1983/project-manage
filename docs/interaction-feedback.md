# Task feedback and mobile navigation

This increment develops the three agreed functional behaviors within the existing Vue interface: completion with linked facts and protected undo, mobile project expansion with reliable return, and selectable upcoming work. It preserves the compact dark list, bilingual labels, light theme, shared editing and intake draft recovery.

## Reference boundary

The four supplied phone references could not be downloaded into this implementation environment. The current Library helper returned `library file transfer failed: download failed` for each initial transfer and its one supported retry; no readable source files existed. The executor did not see their pixels. The parent supplied descriptions and explicitly authorized these functional changes without requiring a pixel reproduction. This report is **functional/browser QA, not reference-fidelity acceptance**. The earlier source-image gate in [design-qa.md](../design-qa.md) remains unchanged. No reference photos, real notes, personal records or credentials are committed.

## Resulting behavior

- A leaf-task checkbox or status selector saves through the active API adapter. The acknowledged task updates the shared project, Today/This week and overall totals. Parent counts continue to derive from leaves. If the subsequent history read fails, the status remains saved, but no activity is invented; the feedback offers a history refresh before enabling undo.
- Feedback identifies the task and saved status. Undo restores the exact preceding status, including “Needs coordination,” using the saved task version and actual activity ID. A later edit disables undo; an unseen concurrent edit is rejected by the server and the current task is refreshed. Repeated completion/undo produces one write. Only the most recent quick status action has this temporary feedback; reload clears it, while persisted history remains available.
- Weekly changes count saved actions, not net completions. Completing then undoing one task leaves two history actions, one completion action, and the original overall done total. Plan membership is still independent of due dates; parents and children are not double-counted.
- Expanded projects retain real task and notes controls. A bottom Collapse action returns focus to the project's expand control, subject to the existing unsaved-change confirmation. All 20 projects remain in the list and can be reached; no stacked overlay hides later projects. Filters, scope, expanded project and focus survive a detail-route round trip within the current session. Account changes and reload reset this in-memory navigation state.
- Upcoming work uses explicit work dates/week membership and leaf status. Mobile cards use native horizontal scrolling with proximity snapping, previous/next buttons, Home/End/arrow navigation on the rail, and a visible selected state. “Show 4 more tasks” exposes the rest; the existing planned-task route remains available. Completion retains the nearest surviving selection; completing the final card reaches a real empty state and moves focus to undo. Reduced-motion preference removes movement.
- Quick intake remains prominent on the project page and expanded details. The existing account-scoped, explicit M1 draft recovery flow is exercised again. There are no schema, credential, provider or authorization changes in this increment.

## Browser findings corrected

1. A sticky feedback offset originally left a gap when scrolled. It now sticks at the viewport top; measured panel height supplies document scroll padding, and dismissal returns focus to main content.
2. Full mobile regression exposed a double-click on Save closing the editor and clicking a project link exposed under the pointer. Repeated pointer activation on buttons/links is now stopped at capture; normal single clicks, keyboard activation and text selection remain available. Existing repeated-save cases pass at desktop, 390px and 375px.
3. Theme evidence initially captured during the color transition. Screenshots now await finite animations, and the upcoming-work region is scanned in its settled light theme.

## Evidence and verification

The seven new Chromium cases cover linked totals/history, duplicate action prevention, undo, network failure and stable retry identity, server-side concurrent-edit protection, empty state/focus, mobile collapse/cancellation/Back, all-project reachability, scrolling and keyboard selection, additional cards, intake recovery, reduced motion, bilingual themes and zero unexpected console/page errors. Ten new unit tests cover planned-work semantics, selection, the status/undo state machine, snapshot failure/races and session isolation.

Final aggregate checks are recorded in [verification.md](verification.md), with exact-commit GitHub Actions linked from draft PR #1.

| Captured state | Evidence |
|---|---|
| Completion, linked totals and real weekly history, 1536px | [Dark desktop](screenshots/interaction-completed-desktop.png) |
| Feedback and touch controls, 390px | [Dark mobile](screenshots/interaction-completed-mobile.png) |
| Expand tasks/notes and collapse return | [Expanded project](screenshots/interaction-project-mobile.png) |
| Scroll selection and additional planned work | [Upcoming mobile cards](screenshots/interaction-planned-mobile.png) |
| Restored status and factual history, Chinese/light | [Desktop](screenshots/interaction-zh-light-desktop.png), [mobile](screenshots/interaction-zh-light-mobile.png) |

These are actual local Chromium captures of synthetic data. They were opened and inspected for readable controls, clipping, focus and overlap. Automated axe checks cover tested states only, not a full accessibility audit. Real Safari/iOS, software keyboards, the previously reported iOS 0 KB symptom, live Codespaces behavior, real multi-person deployment and real model calls are not validated by this increment. No deployment or merge was performed.
