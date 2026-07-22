# Milestone 08: Review Filter Alignment

Goal: Ship a queue rail that matches the due-review workflow for the tracker owner by removing the misleading Hard filter while retaining difficulty badges on rows.

## Scope

- Remove the `Hard` filter and its count from the local dashboard.
- Keep `All due`, `Today`, `Overdue`, and `Needed help` behavior unchanged.
- Keep Easy, Medium, and Hard badges on review rows.
- Release synchronized LCTrack `0.1.6`.

## Non-goals

- Changing Notion data, managed views, schema, capture behavior, or review scheduling.
- Removing difficulty from Problems or dashboard rows.
- Changing search, progressive disclosure, ordering, or responsive layout.

## Slices

1. **Align review filters** — active — remove the Hard filter, verify the remaining rail, and release `0.1.6`.

## Integration notes

- Milestone 07 and LCTrack `0.1.5` are the release baseline.
- Tests changed here are development evidence and require user review before their first execution.

## Exit criteria

- The rail exposes exactly four filters and no Hard filter.
- Hard difficulty badges remain available on matching rows.
- Versions are synchronized at `0.1.6`.
- `npm run check` and `git diff --check` pass freshly.
