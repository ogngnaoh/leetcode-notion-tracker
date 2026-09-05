# Synchronous capture performance

> Historical implementation record. For current operation, use the [documentation index](README.md).

Scope: outcome click (`Needed help` / `Solved`) through durable Notion success. Panel startup,
background queues, deployment, live test captures and schema changes are outside this change.

## Approved approach

- Keep the two databases, stable latest Attempt page, canonical Problem relation and event IDs.
- Load Attempt properties, body, receipts and Problem once inside each per-problem lock. Discard
  this request-local state on success or error; never reuse it across captures.
- Combine Problem metadata, first-attempt and review changes into one update.
- Use validated successful append/update responses instead of redundant read-backs.
- Keep the pending receipt until the Attempt and Problem writes finish. A fresh request recovers
  interrupted writes before computing another review transition.

## Completion evidence

1. Failing request-budget and durability-order tests before changing runtime behavior.
2. At most 10 Notion calls for a normal existing-problem capture with one page of receipts,
   compared with the measured 21-call baseline. No regression for first captures.
3. Controlled-latency measurements for both outcomes; report these as simulation, not live timing.
4. Restart/retry, partial or lost responses, concurrency, pagination, old/equal-time events,
   canonical relation, user notes, first-attempt and streak regression coverage.
5. Fresh `npm run check`, patch version bump and non-editing final review.

## Status

- The initial regression tests failed at **21 calls** for each outcome and showed the pending
  payload was compacted before the final Problem write. Both are fixed in the current working tree.
- Focused tests now cover 10-call replacements (including initial receipt-container creation),
  6-call first captures and 5-call read-only duplicate retries. Each pagination page is read once.
- Fault injection covers failed writes, lost responses after committed writes, incomplete responses
  at all six replacement boundaries, stale Problem responses, recovery before a different event,
  no cross-capture caching and concurrent solves. Existing note/relation/date/retry tests pass.
- Final review added regressions for inconsistent exact-ID/latest lookups and differently ordered
  input object properties. Both initially failed and are fixed without increasing request counts.
- Re-running the original local profiling harness confirms 10 calls with 0 or 2 receipts, and 11
  with 101 receipts (previously 21, 21 and 25). These writes are to an in-memory Notion double only.
- Controlled benchmark: six synchronous saves with **20 ms injected per Notion call**. Original
  service benchmark took 2.71–2.72 seconds total for the test (21 calls/save); optimized benchmark
  additionally exercises the authenticated Hono route and took 1.35 seconds. Optimized request
  latest medians: Needed help 223 ms, Solved 217 ms, 10 calls each. These are synthetic timings, not live
  Notion latency measurements or a promise of subsecond production saves.
- Run the optional benchmark with
  `LCTRACK_CAPTURE_BENCHMARK=1 npx vitest run test/latest-attempt.test.ts -t controlled-latency --disableConsoleIntercept`.
- Final `npm run check` passed: **482 unit tests, 36 browser tests**, TypeScript, formatting,
  production extension build and secret scan. The optional benchmark is skipped by the normal
  suite and was run separately successfully. `git diff --check` is clean.
- Release manifests are synchronized at 0.2.13; preserve the checkout's other existing changes.
  No live Notion writes, service restarts or commits performed during this optimization.

## Decision / handoff

The normal path meets the 10-request budget, a 52% reduction. Controlled timing and the second
review support stopping here rather than expanding into a queue or another storage system. Recovery
still uses fresh Notion state and may require more requests. Start/restart the bridge explicitly to
load the changed runtime; actual production save latency remains a user-acceptance check, not a
measurement claimed by the synthetic benchmark.
