# Compact Review Queue Design

## Problem

The local dashboard correctly accumulates overdue reviews, but its large summary cards and full-width
table become difficult to scan as the queue approaches hundreds of Problems. The queue must retain
every review due today or earlier while becoming substantially denser and easier to narrow.

## Data boundary

`NotionCaptureRepository.loadDashboard(date)` keeps its existing `Next Review on_or_before date`
query. After mapping the returned Problems, it also retains only rows whose calendar-date
`nextReview` is less than or equal to the requested local date. This boundary check guarantees that a
future row cannot reach the dashboard snapshot while keeping all overdue rows.

No schema, review-schedule, Notion view, or capture behavior changes.

## Dashboard layout

The existing server-rendered page remains. Its masthead retains the brand, local date, updated time,
Settings, and Refresh controls with tighter spacing. The two daily summaries become compact metrics
for new Problems and total reviews due.

The review area uses the approved filter-rail layout:

- A narrow rail provides `All due`, `Today`, `Overdue`, `Needed help`, and `Hard`, with counts derived
  from the complete due snapshot.
- A search field matches Problem titles case-insensitively within the selected view.
- One saved view is active at a time; search and the active view combine.
- Dense rows retain title, difficulty, practice state, solved streak, relative due age, exact review
  date, and a safe LeetCode action without card duplication.
- The default order remains oldest review date first, then title, matching the repository query.
- The first 50 matching rows are visible. `Load 50 more` reveals the next batch and disappears when
  every match is visible. Changing the search or saved view resets the visible limit to 50.
- On narrow screens, the filter rail becomes horizontal filter chips and nonessential row metadata
  wraps beneath the title without horizontal page scrolling.

The browser receives no secret or Notion identifier. Rows continue to use server-escaped HTML and the
existing canonical LeetCode URL validation.

## Client behavior

The existing dependency-free dashboard script reads server-rendered row data attributes, calculates
filter membership, hides nonmatching or not-yet-revealed rows, and updates the visible count and load
control. Filtering requires no network request and never mutates Notion. With hundreds of simple rows,
this avoids pagination state and repeated Notion queries while remaining appropriate for the personal
MVP.

The controls use native buttons and a labeled search input. The active filter exposes
`aria-pressed`, filtered status is announced through a polite live region, and existing focus-visible
styling is extended to the new controls.

## Failure and empty states

Existing first-load, unavailable, and stale-snapshot behavior remains. A stale snapshot is filtered
against the date stored on that snapshot. If no rows match the selected view or search, the queue
shows a filter-specific empty message without claiming that all reviews are complete. The existing
`All caught up` message remains only when the complete due snapshot is empty.

## Verification design

Before production changes, repository coverage will return overdue, today, and future rows from the
fake Notion client and expect only overdue and today rows in the snapshot. Dashboard rendering and
browser-script coverage will define the compact structure, filter counts, combined search/view
behavior, 50-row disclosure boundary, reset behavior, safe links, and narrow-layout hooks.

These tests are development evidence because they are created in the same effort. The unchanged
project-wide `npm run check` command remains the completion check and must pass after the focused
red-green cycle, along with `git diff --check`.
