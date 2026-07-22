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
- Compact local review queue with an inclusive `Next Review <= today` cutoff, defensive future-row
  exclusion, five saved views, title search, and 50-row progressive disclosure without Notion writes
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
- Version 0.1.5 LCTrack personal-use release with the `leetcode tracker (notion-powered)` description
  and Chrome-supported Lucide SquareTerminal PNG icons
- Unit and route tests
- Visible one-click iTerm2 bridge launcher with atomic duplicate-start suppression and stale-claim recovery

## Verified with the real workspace and Chrome

- The live manifest and both reciprocal Notion data sources are exact v4; `npm run notion:verify`
  verifies 14 Problems properties, 13 Attempts properties, option colors, presentation, and views.
- The approved v4 apply preserved the `First Attempt` property ID, eliminated all obsolete row values,
  matched every Problem to its earliest Attempt, retained its recovery backup, and replays as a no-op.
- LCTrack `0.1.4` is loaded and enabled in actual Chrome with exactly `Needed help` and `Solved`; the
  equivalent `0.1.3` build captured exact visible Monaco code through the v4-gated bridge before the
  date-rollover-only patch.
- On 2026-07-22, Longest Consecutive Sequence `Needed help` changed the dashboard count from 0 to 1,
  stored streak 0, and remained due 2026-07-22. A second Attempt used a distinct Client Event ID while
  the count stayed 1 and the original First Attempt timestamp remained unchanged.
- On 2026-07-22, Valid Parentheses `Solved` changed the count from 1 to 2, stored streak 1, scheduled
  2026-07-23, and preserved the exact independently inspected 12-line Python body.
- The tracked Dock launcher opens through Finder in iTerm2, starts the exact expected localhost bridge,
  refuses duplicates and unknown port owners, stops with Ctrl-C, and restarts cleanly.

## Release evidence

- Milestones 01 through 07 are shipped; milestone 04’s paid Notion dashboard remains retired.
- Fresh LCTrack `0.1.5` `npm run check` passes formatting, TypeScript, 341 Vitest tests, 24 Playwright
  scenarios, the extension build, and the security scan.
- The standalone security scan and `git diff --check` passed. Follow-up review found no unresolved
  Critical or Important findings after all migration/runtime safety fixes.
- Tests changed during milestones 06 and 07 are development evidence; the live Notion and actual
  Chrome checks above are independent rollout observations for milestone 06, not the compact queue.

## Intentionally deferred

- Cloud deployment
- Offline queue
- Multiple tracker schemas
- Notion OAuth for other users
- Recruiting/application tracking
