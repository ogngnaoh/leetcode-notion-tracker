# First-Attempt Tracking and Two-Outcome Design

Status: approved

## Product behavior

“New” means a canonical Problem received its first-ever logged Attempt, regardless of result. Problem
identity remains `External Key = leetcode:<slug>`. The extension presents exactly two compact,
user-confirmed outcomes: `Needed help` and `Solved`, with no added explanatory UI text.

`Needed help` produces state `Needed help`, solved streak 0, and `Next Review` equal to the attempt's
local calendar date. `Solved` retains the existing 1/3/7/14-day schedule and advances to `Mastered` at
streak 5. Reviews never increase the new-problem count.

## Storage and capture consistency

Problems replace `First Solved` with `First Attempt`, preferably retaining the Notion property ID.
`First Attempt` stores the earliest full `Attempted At` timestamp across related Attempts. A new capture
sets it only after the immutable Attempt exists. An exact duplicate retry repairs a missing Problem
write from its stored Attempt. A delayed older event may move the value earlier but never later.

Capture endpoint paths and payload shape remain unchanged except that `result` accepts only
`Needed help | Solved`. Existing exact retry, tab isolation, selected-result display, distinct Client
Event IDs for deliberate clicks, and user confirmation remain unchanged.

The dashboard queries `First Attempt = today`, uses internal `newProblemCount`, and displays
`NEW PROBLEMS TODAY` plus first-attempt wording. The persisted `dailyNewProblemGoal`, environment
`DAILY_NEW_PROBLEM_GOAL`, and settings API remain unchanged.

## Exact v4 migration

Fresh setup creates manifest/schema v4. Version-2 workspaces still migrate through v3 before v4. The
v3→v4 dry-run paginates all Problems and Attempts and writes a token-free backup without mutation.
Apply journals before mutation, renames the property, backfills earliest Attempts, reclassifies every
`Couldn’t solve` Problem/Attempt value to `Needed help`, removes obsolete select options only after row
conversion, verifies exact v4, and only then writes the manifest. Recovery artifacts survive every
failure until that manifest is durable.

The migration preserves same-day next-review values, streaks, IDs, relations, timestamps, code bodies,
and Client Event IDs. Historical reclassification is the single approved exception to Attempt
immutability. Unknown or contradictory schemas fail closed; an exact completed v4 rerun does nothing.

## Acceptance scenarios

1. A new `Needed help` Problem creates one Attempt, increases today's count once, has streak 0, and is
   due today; reviewing it creates another Attempt without increasing the count.
2. A new `Solved` Problem creates one Attempt, increases today's count once, and is due tomorrow.
3. Earlier delayed Attempts correct `First Attempt`; duplicates repair missing writes without creating
   another Attempt; no capture moves the timestamp later.
4. The extension renders exactly the two approved buttons and preserves all capture safety behavior.
5. v4 dry-run/apply/recovery satisfies pagination, preservation, reclassification, exact verification,
   fail-closed, durable-journal, and no-op replay requirements.
