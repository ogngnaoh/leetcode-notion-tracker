# Milestone 07: Compact Review Queue

Goal: Ship a compact local review queue for the tracker owner so an accumulated backlog of hundreds
of due Problems remains easy to scan, filter, and open.

## Scope

- Keep every Problem whose `Next Review` is today or earlier in the local dashboard queue.
- Defensively exclude future review dates even if an upstream response contains one.
- Replace the large summary and table presentation with a compact filter rail and dense review list.
- Support text search plus the `All due`, `Today`, `Overdue`, and `Needed help` views.
- Preserve Easy, Medium, and Hard difficulty badges on review rows.
- Show 50 matching rows initially and reveal additional rows in batches of 50.
- Preserve responsive use, keyboard access, stale-data behavior, safe LeetCode links, and manual review.

## Non-goals

- Changing the review schedule or removing overdue Problems from the backlog.
- Mutating Notion when a dashboard filter is used.
- Persisting dashboard filters, adding server-side pagination, or introducing another database.
- Adding completion controls, automatic capture, analytics, coaching, React, or a UI framework.

## Slices

1. **Compact review queue** — shipped — enforce the inclusive due cutoff and ship the dense,
   searchable, progressively disclosed dashboard view.

## Integration notes

- Milestone 06 and LCTrack `0.1.4` are the release baseline.
- The Notion query already requests `Next Review on_or_before` the local date; local filtering is a
  second boundary check, not a scheduling change.
- Tests added or changed in this milestone are development evidence rather than independent verification.
- LCTrack `0.1.5` shipped the compact queue; the `0.1.6` follow-up removes the misleading Hard filter
  while retaining difficulty badges and synchronized package, lockfile, and extension versions.
- The `0.1.7` follow-up keeps automatic first-Problem counting but makes its session boundary a
  confirmed local manual reset, without changing Notion history or review behavior.

## Exit criteria

- Overdue and today rows appear; future rows do not.
- The selected saved view and search term combine predictably, counts reflect the full due snapshot,
  and rows reveal in batches of 50.
- Desktop and narrow layouts remain usable with keyboard-visible controls and safe outbound links.
- Synchronized version `0.1.7`, development tests, `npm run check`, and `git diff --check`
  pass freshly.
