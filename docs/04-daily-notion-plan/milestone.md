# Milestone 04: Daily LeetCode Plan in Notion (retired)

Goal: Ship a Notion-native daily dashboard that shows first-time solves and due reviews so the
tracker gives one clear daily starting point.

## Scope

- Add and maintain the earliest successful `First Solved` timestamp on Problems.
- Add the `Daily plan` dashboard, two number widgets, and a direct-link review table.
- Add v2→v3 migration, recovery, verification, and goal synchronization.
- Preserve both database identities, all existing rows and relations, and unrelated views.

## Non-goals

- Changes to capture payloads, bridge routes, review scheduling, Attempts schema, or Review queue.
- Notifications, a third database, catalog scraping, cookies, or private LeetCode APIs.

## Slices

1. **Daily dashboard and v3 migration** — shipped — implement First Solved capture/repair, durable
   migration, exact managed dashboard presentation, goal sync, verification, and live acceptance.

## Integration notes

- Retired in milestone 05 because the shipped dashboard requires a Notion Business plan. The
  plan-independent `First Solved` field and manifest/schema version 3 remain supported.
- `First Solved` derives only from the earliest Attempt whose Result is `Solved`.
- Tests added in this slice are development evidence; pre-existing checks and live read-back remain
  the independent verification sources.
- Live apply recovered forward from two dashboard-verification failures without duplicating the
  dashboard or widgets and promoted the manifest only after exact read-back succeeded.
- Final verification found and restored pre-existing `Recent attempts` presentation drift on its
  preserved view ID; Attempts rows, schema, relations, and IDs were unchanged.

## Exit criteria

- Fresh setup creates v3 with exactly two databases and the complete dashboard.
- Migration inventories all rows, backs up and journals before mutation, backfills First Solved,
  verifies widgets and rows, then atomically writes manifest v3.
- Exact-ID retries repair partial First Solved writes without duplicating Attempts.
- Goal sync changes only the managed goal widget and rejects ambiguous managed names.
- Project checks, live Notion verification/queries, security scan, and whitespace checks pass.
