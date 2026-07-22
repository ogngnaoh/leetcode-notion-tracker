# Slice 05: One-Click LeetCode Capture Overhaul

Goal: Ship a one-click, user-confirmed capture flow that records the visible completed attempt exactly once and updates the two-database Notion review loop without stale-state rewinds.

## Design

- Clicking one of three equal-weight outcomes — `Couldn’t solve`, `Needed help`, or `Solved` — creates the confirmed capture. There is no automatic submission.
- At startup and click time, the content script reads only the public page DOM. It reconstructs Monaco
  logical lines from rendered fragments and public gutter positions, labels incomplete ranges, and
  never focuses or scrolls LeetCode.
- An authenticated problem-status GET supplies the current review state. Calendar-date scheduling uses solved-streak intervals of 1, 3, 7, and 14 days, reaching Mastered at 5.
- One session-scoped pending event freezes its Client Event ID, payload, code snapshot, and page
  fingerprint. Exact retry reuses that event. Successful writes become presentation-only last-success
  records; every later deliberate click creates a new Client Event ID even for unchanged code.
- Duplicate handling must not let an older replay overwrite newer Problem state. `External Key` and `Client Event ID` remain the canonical idempotency keys.
- The existing two Notion databases migrate in place to the v2 properties, with a backup and explicit preservation of legacy data.
- Deterministic MV3 Playwright coverage exercises extraction, click confirmation, retry, navigation, and state rendering. UI assets use the approved self-contained light design system.

The boundaries remain exactly two Notion databases, a narrow authenticated bridge, public-DOM-only LeetCode reads, and explicit user confirmation.

## Remaining checklist

- [x] Define and test the v2 capture, problem-status, review-state, fingerprint, and retry contracts.
- [x] Add the authenticated narrow problem-status GET and stale-replay protection.
- [x] Implement calendar-date review scheduling and solved-streak transitions.
- [x] Prepare, back up, run, and verify the in-place two-database Notion v2 migration.
- [x] Implement click-time public-DOM metadata, topic, Monaco code, and language extraction.
- [x] Build the three-outcome one-click panel with the approved light design-system assets.
- [x] Implement session-scoped exact retry and last-success presentation state.
- [x] Add deterministic MV3 Playwright coverage for the complete capture state flow.
- [x] Run the genuine Chrome-to-Notion acceptance checklist below with a new attempt.
- [x] Record Slice 05 evidence, ship this slice, and activate release.

## Genuine acceptance checklist

1. Load the built extension in Chrome.
2. Use a genuine newly completed LeetCode attempt.
3. Click exactly one result: `Couldn’t solve`, `Needed help`, or `Solved`.
4. Confirm exactly one Attempt exists in real Notion.
5. Confirm its page body contains the exact visible code snapshot under `Captured code`.
6. Confirm the canonical Problem has the expected Practice State, Solved Streak, and calendar-date Next Review.
7. Confirm replay/retry of the same Client Event ID does not create another Attempt.

## Prior Chrome verification coverage

The superseded checklist covered Two Sum and `longest-substring-without-repeating-characters`, client-side navigation, non-LeetCode rejection, missing/wrong token handling, no POST before confirmation, retained retry after a stopped bridge, exactly one real Medium Attempt, and stopping the bridge after evidence. None of those live Chrome checks had been completed before this pivot.

## Record

- 2026-07-20: Activated after the fixed bridge sample passed authentication, validation, replay, and real Notion inspection.
- 2026-07-20: The prior handoff recorded that the extension had not been loaded or tested in the owner's browser; there were no completed live Chrome observations to carry forward.
- 2026-07-20: Pivoted the active slice to the user-reviewed One-Click LeetCode Capture Overhaul and preserved the reviewed genuine acceptance checklist above.
- 2026-07-20: `npm install` succeeded with dependencies already up to date. The initial `npm run check` stopped in Prettier on seven untracked `.superpowers/` HTML artifacts.
- 2026-07-20: A focused scanner test failed red because importing the module executed its CLI, no callable export existed, and the recursive scan reported the ignored `.env` location. No secret content was printed.
- 2026-07-20: Excluded `.superpowers/` from Git/project and Prettier inputs without deleting or formatting the artifacts. Changed the scanner to use Git's tracked/non-ignored set plus explicit `dist/extension` output; the focused test then passed.
- 2026-07-20: `npm run check` passed formatting, TypeScript, 26/26 tests, the extension build, and the revised security scan. Tests added in this effort are development evidence, not independent verification.
- 2026-07-20: Implemented the purpose-built v1→v2 migration behind dry-run-by-default `npm run notion:migrate:v2`. Fake-client and temporary-filesystem coverage exercises exact shape refusal, manifest compatibility, 100-row cursor pagination, token-free backups, mappings/date conversion, false/0 legacy preservation, marker deduplication, operation order, exact v2 verification, atomic manifest preservation, and v2 no-op. The real workspace has not been contacted or migrated in this task.
- 2026-07-20: Documented the then-manual `Due now` view; Milestone 03 later replaced it with API-managed views.
- 2026-07-20: Hardened migration recovery after review: apply now atomically journals original values and expectations before mutation, resumes mixed/final v2 states only with a matching journal, completes and verifies exact paginated legacy labels before deletion, validates intermediate colors and reciprocal relation configuration, strictly parses calendar/offset dates, and keeps all migration artifacts under project `build/`.
- 2026-07-20: Added import-safe public-DOM extraction with browser-edge visibility checks, exact visible Monaco textarea values, bounded nearby-first language normalization, visible ordered topic links, title/number and document-title fallbacks, and structured unavailable-code results. Fingerprints are lowercase SHA-256 over the UTF-8 JSON array encoding of `[slug, language, exact code]`. Fresh GET extraction and debounced mutation/input/SPA publication use availability/location keys and single-flight revision ordering. Review replaced the isolated-world history patch with cleaned-up 250 ms href polling and removed the global difficulty-text scan so unrelated page labels cannot supply difficulty. Focused Vitest coverage passed 25/25; these task-authored tests are development status, not independent verification.
- 2026-07-20: Replaced the daily form with the balanced three-outcome panel. A per-tab `chrome.storage.session` record persists the exact serialized event before sending, retains uncertain writes across panel reopen and page changes, clears definitive rejections, and locks successful fingerprints until a confirmed changed fingerprint arrives. Click-time revalidation suppresses stale posts; missing code or credentials remain actionable. Vendored the approved Inter 400/500 and IBM Plex Mono 400 fonts plus the used light-system CSS subset with recorded SHA-256 provenance and SIL OFL 1.1 text. Focused controller/static coverage passed 32/32 before the final project check; these task-authored tests are development status, not independent verification.
- 2026-07-20: Review found two side-panel lifecycle gaps: changed/unavailable click-time snapshots inherited a stale busy flag, and the panel remained bound to its startup tab. Focused red runs reproduced both. Snapshot acceptance now derives busy only from a real submission and a second deliberate click succeeds after readable refresh. A generation-bound active-tab coordinator listens to tab activation, relevant active-tab updates, window focus, and active-tab content messages; it deactivates stale controllers before they can post or render, queues context until session initialization, reuses same-tab bindings, and restores each tab's own session record on return. Focused controller/coordinator/static coverage passed 42/42 before the final project check; these task-authored tests are development status, not independent verification.
- 2026-07-20: Added a single-worker headless MV3 Playwright project using a fresh persistent profile and Playwright's bundled Chromium channel. It derives the unpacked extension ID from the service-worker URL, opens the real side-panel extension URL, substitutes deterministic LeetCode-shaped navigation documents at matching public URLs, and hard-binds an authenticated mock bridge to `127.0.0.1:8787` with no real-service fallback. Fifteen serial browser scenarios cover extraction/rendering, status states, no pre-click POSTs, all outcomes and exact v2 payloads, SPA/tab rebinding, credentials and unavailable code, exact retained retry across panel reload, definitive reset, duplicate success, fingerprint lock, click-time mismatch, and in-flight de-duplication. The focused suite passed 15/15; because it was authored in this effort, this is development evidence rather than independent verification. Genuine live LeetCode and Notion acceptance remains pending.
- 2026-07-20: Revised the active slice before acceptance. Focused red-green tests cover Monaco
  logical-line reconstruction, soft wraps, indentation, blank lines, nonbreaking spaces, complete and
  partial ranges, startup reinjection, version-1 compatibility, repeat attempts, persistent selection,
  fingerprint clearing, in-flight suppression, compact section order, expanded code, and accessible
  selection. The MV3 fixture now keeps Monaco's textarea blank/unfocused and passed 16/16 scenarios.
- 2026-07-20: Live Chrome recognized Valid Sudoku without editor focus, page scrolling, or tab refresh
  after the unpacked extension reload. The panel showed #36, Medium, Array/Hash Table/Matrix, Python,
  expanded `visible lines 1–9`, active outcomes, and persistent `Couldn’t solve` selection.
- 2026-07-20: Real Notion inspection found one total Attempt: Client Event ID
  `8318f850-d922-49a3-9e6a-37af14d9c492`. Its page body contains the exact rendered code including
  continuation fragments; the Problem is `Couldn’t solve`, streak 0, next review `2026-07-20`.
  Replay returned `duplicate: true`, the same Attempt page ID, and count 1. The plan assumed an earlier
  Valid Sudoku Attempt, but the complete inventory contained no prior Attempt; this effort deleted none.
- 2026-07-20: Final review found and focused red tests reproduced status-response overwrite,
  click-lock, post-success storage, `/description/` routing, stale distinct-event, Unicode chunking,
  Difficulty verification, and paginated legacy-property risks. The fixes keep exact retry in memory
  until durable success state, prevent canonical rewinds, hydrate every legacy property item before
  backup/deletion, and update the v2 handoff contract. Focused Vitest passed 223/223 and the MV3 suite
  passed 16/16; both remain changed-check development evidence.
