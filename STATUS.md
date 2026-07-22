# Scaffold status

## Implemented and locally verifiable

- Strict TypeScript project
- Zod capture contract
- Stable problem keys
- Review-state transition logic
- Idempotent capture service contract
- In-memory repository for tests
- Hono health and capture routes
- Bearer-token protection for capture writes
- Direct Notion API repository
- One-time two-database setup command
- Safe, dry-run-by-default in-place Notion v1→v2 migration command
- Exact v2 schema verification command
- Exact v4 verification and dry-run-by-default v2→v3→v4 migrations
- Earliest first-Attempt capture convergence with duplicate repair and delayed-event correction
- Two-outcome `Needed help` / `Solved` capture contract and same-day assisted review
- Local daily dashboard with Notion-backed counts, in-memory refresh, stale fallback, and a locally
  persisted 1–100 new-problem target
- Dry-run-by-default rollback for the retired paid Notion dashboard
- Reproducible Notion icons, descriptions, native option colors, and managed table views
- MV3 side-panel extension
- LeetCode current-page metadata extraction
- Automatic public-DOM topic/language extraction and rendered Monaco logical-line reconstruction
- Compact one-click panel with expanded code, persistent last-result selection, and per-tab exact retry
- One-time content-script reinjection after extension reload
- Deterministic bundled-Chromium MV3 acceptance suite
- Extension settings page
- Always-visible extension shortcut that focuses or creates the configured local dashboard tab
- Tab-scoped extension action available on any tab without carrying the panel into other Chrome tabs
- Explicit click-only capture controls
- Extension production build
- Version 0.1.2 LCTrack personal-use branding with the `leetcode tracker (notion-powered)` description
  and Chrome-supported Lucide SquareTerminal PNG icons
- Unit and route tests
- Visible one-click iTerm2 bridge launcher with atomic duplicate-start suppression and stale-claim recovery

## Verified with the real workspace and Chrome

The items below are pre-v4 external evidence. The live workspace remains version 3 until the v4 dry
run is reviewed and apply is explicitly approved.

- The v2 manifest targets exactly one Problems and one Attempts data source.
- Live Valid Sudoku recognition populated number, title, Medium, Array/Hash Table/Matrix, Python, and
  rendered lines 1–9 without editor focus or page scrolling.
- A user-confirmed `Couldn’t solve` capture created Attempt
  `8318f850-d922-49a3-9e6a-37af14d9c492`, stored the exact rendered code, and set state/streak/date to
  `Couldn’t solve` / `0` / `2026-07-20`.
- Replaying that Client Event ID returned `duplicate: true` and kept the Valid Sudoku Attempt count at
  one.
- The tracked Dock launcher opens through Finder in iTerm2, starts the exact expected localhost bridge,
  refuses duplicates and unknown port owners, stops with Ctrl-C, and restarts cleanly.
- The live Problems and Attempts databases have the LC Log presentation contract; API read-back
  confirmed the original Problem page ID and null Difficulty, zero Attempts, and zero pending changes.
- The live manifest is version 3 with `First Solved` backfilled from paginated Attempts.
- Independent 2026-07-21 queries confirmed 1 new solve and 5 due-review rows with exact direct URLs,
  fields, and ordering.

## Release evidence

- Milestone 06 development evidence currently includes a clean TypeScript check, 341 Vitest tests,
  and 21 Playwright scenarios. These changed tests are not independent verification; final stopped-
  bridge checks and live rollout remain pending. Follow-up review found no unresolved Critical or
  Important findings.

- Milestones 01 through 05 are shipped; milestone 04’s paid Notion dashboard is retired.
- Fresh `npm run check` passed formatting, TypeScript, all 326 Vitest tests, all 22 Playwright
  scenarios, the extension build, and the security scan after the label-clearance, tab-scoping, and
  direct-user-gesture side-panel opening follow-ups.
- The latest external `npm run notion:verify` evidence verified 14 Problems and 13 Attempts properties
  plus icons, descriptions, option colors, and managed views in the real v3 workspace.
- The standalone security scan and `git diff --check` passed; final review reported no unresolved
  Critical or Important findings.

## Intentionally deferred

- Cloud deployment
- Offline queue
- Multiple tracker schemas
- Notion OAuth for other users
- Recruiting/application tracking
