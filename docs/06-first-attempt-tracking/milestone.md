# Milestone 06: First-Attempt Tracking and Two-Outcome Model

Goal: Ship first-attempt-based practice counts and a two-outcome capture model for the tracker owner
so every newly practiced Problem counts once and assisted work remains due today.

## Scope

- Narrow canonical capture outcomes to `Needed help` and `Solved`.
- Track each Problem's earliest full Attempt timestamp as `First Attempt`.
- Keep `Needed help` at streak 0 and due on the attempt's calendar day.
- Count `First Attempt = today` on the local dashboard and update its visible copy.
- Migrate exact v3 workspaces to schema/manifest v4 with paginated, token-free recovery artifacts.
- Preserve exact retry, tab isolation, user confirmation, Client Event ID, and Solved progression behavior.

## Non-goals

- Additional outcomes, explanatory extension copy, a legacy runtime alias, or another scheduling model.
- More Notion databases, a generic Notion proxy, automatic capture, private LeetCode access, or bulk scraping.
- Renaming `dailyNewProblemGoal`, `DAILY_NEW_PROBLEM_GOAL`, or the dashboard settings API.

## Slices

1. **First-attempt tracking and two-outcome model** — active — update contracts, capture/repository
   behavior, exact v4 setup/migration/verification, the extension, dashboard, browser acceptance,
   rollout documentation, and live verification.

## Integration notes

- Baseline commit `f0bbb49` preserves the completed milestone 02–05 working tree before v4 work.
- Historical `Couldn’t solve` Attempt values may be rewritten only by the approved v4 migration.
- Tests added or changed in this milestone are development evidence and require user review before
  their first execution; they are not independent verification.
- The live migration remains dry-run first and apply requires separate user approval after output review.

## Exit criteria

- Contracts, repository behavior, extension UI, and dashboard use only the two approved outcomes and
  first-attempt semantics.
- Fresh setup produces exact v4; exact v2 progresses through v3; exact v3 migrates safely to v4; unknown
  or contradictory shapes fail closed and a completed rerun is a no-op.
- The v4 dry-run/apply paths paginate both databases, preserve required values, verify exact v4 before
  the manifest write, and retain recovery artifacts until the manifest is durable.
- Reviewed development tests, `npm run check`, `npm run security:scan`, and `git diff --check` pass.
- Approved live Notion and Chrome checks confirm one count per new Problem and same-day assisted review.
