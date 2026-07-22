# Milestone 05: Local LC Log Daily Dashboard

Goal: Ship a fast localhost daily dashboard for the tracker owner so solve progress and due reviews
remain useful without a Notion Business plan.

## Scope

- Safely inventory, back up, and remove only the managed Notion `Daily plan` dashboard and widgets.
- Keep schema/manifest v3 and `First Solved`, while removing dashboard provisioning and sync behavior.
- Add the read-only local dashboard, paginated Notion queries, coalesced in-memory refresh, and stale fallback.
- Keep dashboard counts in Notion while persisting only the configurable 1–100 daily target locally.
- Share LC Log visual assets with the extension and update the visible Dock launcher to open the dashboard.
- Cover responsive, accessible normal, empty, loading, stale, and unavailable states.

## Non-goals

- Hosting, a third database, persistent local storage, analytics, or automatic review completion.
- Changes to the capture contract, review schedule, or user-confirmed extension workflow.
- Private LeetCode APIs, cookies, request interception, or bulk scraping.

## Slices

1. **Local dashboard runtime** — shipped — add configuration, query/cache model, public HTML route,
   shared assets, and capture-triggered refresh.
2. **Safe Notion rollback** — shipped — add dry-run inventory/backup and exact idempotent deletion,
   then remove provisioning, verification, and sync behavior.
3. **Launcher and browser acceptance** — shipped — open after health, verify responsive states and
   focus refresh, complete live rollback/queries, and update project documentation.
4. **Configurable goal and extension shortcut** — shipped — atomically persist the local target,
   protect its narrow route, add the accessible settings dialog, and focus or create the dashboard
   from the side-panel masthead.

## Integration notes

- Milestone 04 shipped successfully but its dashboard depends on a paid Notion capability, so the
  dashboard portion is retired; `First Solved` remains valuable and is not rolled back.
- The pre-change unit suite passed 267 tests. The baseline browser suite could not bind localhost in
  the workspace sandbox (`listen EPERM`) and did not run.
- Tests added or changed here are development evidence, not independent verification.
- Notion remains canonical for all counts and rows. The ignored settings file contains only the local
  goal, with `.env` used solely as its first-run fallback.

## Exit criteria

- Only the four exactly managed dashboard views are removed; ambiguous names fail closed and unrelated views remain.
- The public localhost dashboard is secret-free, uncached, CSP-restricted, responsive, and refreshes safely.
- Startup/capture/focus refresh behavior and launcher browser opening are covered and manually exercised.
- Live Notion rollback, independent counts/rows, `notion:verify`, project checks, security scan, and whitespace checks pass.
