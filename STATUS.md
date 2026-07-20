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
- MV3 side-panel extension
- LeetCode current-page metadata extraction
- Automatic public-DOM topic/language extraction and rendered Monaco logical-line reconstruction
- Compact one-click panel with expanded code, persistent last-result selection, and per-tab exact retry
- One-time content-script reinjection after extension reload
- Deterministic bundled-Chromium MV3 acceptance suite
- Extension settings page
- Explicit click-only capture controls
- Extension production build
- Version 0.1.2 LC Log personal-use branding with the `leetcode tracker (notion-powered)` description
  and Chrome-supported Lucide SquareTerminal PNG icons
- Unit and route tests
- Visible one-click iTerm2 bridge launcher with atomic duplicate-start suppression and stale-claim recovery

## Verified with the real workspace and Chrome

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

## Remaining manual workspace step

- Create the UI-only `Due now` view: `Next Review on or before Today`, ascending.

## Release evidence

- Milestones 01 and 02 are shipped.
- Fresh `npm run check` passed 241 Vitest tests, 16 MV3 Playwright scenarios, formatting, TypeScript,
  the extension build, and the security scan.
- Fresh `npm run notion:verify` verified 13 exact Problems properties and 13 exact Attempts properties
  in the real v2 workspace.
- The standalone security scan and `git diff --check` passed; final review reported no unresolved
  Critical or Important findings.

## Intentionally deferred

- Cloud deployment
- Offline queue
- Public-API management of the `Due now` Notion view (unsupported by Notion)
- Multiple tracker schemas
- Notion OAuth for other users
- Recruiting/application tracking
