# First-Attempt Tracking and Two-Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` and
> `superpowers:test-driven-development`. This file is both the active plan and its execution record.

**Goal:** Implement the approved milestone 06 design without expanding the two-database, localhost,
user-confirmed architecture.

**Architecture:** Narrow the shared contract first, then make capture/repository state converge on the
earliest Attempt timestamp. Add an exact, journaled v3→v4 migration before switching fresh setup and
verification to v4, then integrate the extension and dashboard copy/query changes.

**Tech stack:** TypeScript, Zod, Hono, Notion REST API, Chrome Manifest V3, Vitest, Playwright.

## Current checklist

- [x] Present the core contract, scheduling, capture, repository, and dashboard tests for user review.
- [x] Observe those reviewed tests fail against v3 behavior. (19 intended failures)
- [x] Implement two-value contracts, same-day `Needed help`, and first-Attempt capture convergence.
- [x] Implement first-attempt dashboard query/model/copy and pass focused core tests. (104 passed)
- [x] Commit core contracts and capture behavior. (`427e8c7`)
- [x] Present the v4 schema/migration tests for user review.
- [x] Observe those reviewed migration tests fail against v3 behavior. (missing module and v3 schema)
- [x] Implement exact v4 schema, setup, verifier, CLI, backup, journal, recovery, and no-op replay.
- [x] Pass focused migration tests. (46 initial migration checks plus 20 safety/repository checks)
- [x] Present the extension static/browser test changes for user review.
- [x] Implement the exact two-button extension and pass focused unit/browser tests. (93 unit/static and
      17 browser checks)
- [x] Update architecture, schema, security, manual QA, README, status, and handoff records.
- [x] Complete follow-up code review after resolving all six Important migration/runtime findings.
      (no remaining Critical or Important issues)
- [x] Define the release versioning convention and synchronize the milestone 06 release as `0.1.3`.
- [ ] Stop the bridge and run `npm run check`, `npm run security:scan`, and `git diff --check`.
- [ ] Review live dry-run output with the user before any apply; after approved rollout, verify Notion and
      Chrome acceptance scenarios, ship the slice, rewrite handoff, stop processes, and commit docs.

## Commit boundaries

1. `feat: track first attempts in capture flow`
2. `feat: add notion schema v4 migration`
3. `feat: integrate two-outcome practice experience`
4. Documentation shipment commit after approved live rollout.

## Test-review gate

No newly added or changed test may run until its exact diff has been shown to and reviewed by the user.
Those tests establish red/green development evidence only. Pre-existing unchanged checks remain the
independent baseline recorded in `milestone.md` and `handoff.md`.
