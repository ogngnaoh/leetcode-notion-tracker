# Milestone 01: Personal LeetCode → Notion MVP

Goal: Ship a reliable personal Chrome-to-local-bridge-to-Notion workflow so one user can log confirmed LeetCode attempts without exposing Notion credentials or creating duplicates.

## Scope

- Establish a reproducible local baseline and Sustain evidence trail.
- Preserve exactly two Notion databases: Problems and Attempts.
- Retain the exact capture event across uncertain extension retries.
- Return actionable, secret-safe bridge failures.
- Provision and verify the real Notion schema once.
- Verify bridge idempotency and the one-click Chrome capture end to end.
- Produce fresh release checks, security scans, and observed evidence.

## Non-goals

- Cloud hosting, OAuth, user accounts, or a second application database.
- A generalized Notion proxy, schema mapper, migration framework, or offline queue.
- Private LeetCode APIs, cookies, request interception, crawling, or automatic submission logging.
- React, Next.js, a monorepo framework, an ORM, or Docker.

## Slices

1. **Baseline and tracking** — shipped — initialized local Git, restored the corrected public-registry lockfile, passed the unchanged project check, and committed the scaffold plus milestone records.
2. **Retry safety and secret-safe errors** — shipped — uncertain failures retain the exact in-memory event, retry fields lock, responses are validated and classified, and bridge diagnostics are bounded and redacted.
3. **Real Notion provisioning** — shipped — created and verified exactly two databases, one data source each, reciprocal relations, all required properties, and a secret-free manifest.
4. **Bridge verification** — shipped — verified health, authentication, validation, exact duplicate replay, and the resulting real Notion Problem, Attempt, reflection, and code.
5. **One-Click LeetCode Capture Overhaul** — shipped — migrated the existing two-database tracker,
   shipped automatic rendered-DOM recognition, compact repeatable outcomes, exact uncertain retry,
   deterministic browser coverage, and genuine Chrome-to-Notion acceptance.
6. **Release** — shipped — fresh checks, real schema verification, release evidence, and milestone
   closeout are recorded in `06-release.md`.

## Integration notes

- The approved implementation sequence is baseline → retry safety → Notion → bridge → Chrome → release.
- Existing `External Key` and `Client Event ID` behavior remains the idempotency contract.
- Tests added during this milestone are development status evidence, not independent verification.
- The unchanged `npm run check`, real schema inspection, duplicate sample replay, live Chrome capture, and secret scan are the completion evidence.
- The original lockfile contained 116 sandbox-internal `resolved` URLs. They were rewritten to `https://registry.npmjs.org/` without changing pinned versions or integrity hashes; a fresh `npm ci` then restored 61 packages with zero reported vulnerabilities.
- The user reviewed the retry-coordinator, API-classification, malformed-JSON, and secret-safe route tests after their expected red runs and before production changes.
- Runtime schema validation was kept out of the extension bundle; a narrow success-response guard preserves the contract while keeping the built side panel at 7.9 KB.
- The real shared Notion parent was inspected empty before setup. The one-time setup completed on its first invocation; no cleanup or retry was needed.
- The fixed sample returned 201 then 200 with identical page IDs and left exactly one Two Sum Attempt. No post-Attempt update failure occurred naturally, so live reconciliation was not exercised.
- The original Chrome slice was activated but no live Chrome checks were completed before the user-reviewed one-click pivot; its intended coverage is preserved in `05-one-click-capture.md`.
- The v2 design keeps exactly two Notion databases and a narrow bridge while adding three equal one-click outcomes, click-time public-DOM code/topic/language extraction, calendar-date solved-streak scheduling, authenticated problem status, stale-replay protection, session-scoped exact retry, an in-place Notion migration, and deterministic MV3 Playwright coverage.
- On 2026-07-20, `npm install` succeeded. The initial check stopped because Prettier traversed seven untracked `.superpowers/` HTML artifacts; the scanner's focused red run then confirmed the known ignored `.env` false positive without printing its contents.
- The scanner now uses Git's tracked/non-ignored files plus explicit `dist/extension` output and reports only finding type and location. Its focused test passed, followed by `npm run check` with 26/26 tests.
- The approved UX correction replaced focus-dependent textarea capture with numbered rendered-line
  reconstruction, changed success locking to presentation-only `lastSuccess`, and made each deliberate
  unchanged-code click a new Attempt while preserving byte-identical uncertain retry.
- Live Valid Sudoku acceptance recognized metadata, below-viewport topics, Python, and rendered lines
  1–9 without touching the editor. Client Event ID `8318f850-d922-49a3-9e6a-37af14d9c492` stored the
  exact code and `Couldn’t solve` / `0` / `2026-07-20`; replay returned duplicate and kept one Attempt.
- The approved plan assumed an earlier Valid Sudoku Attempt preceded this correction. A complete
  post-capture inventory contained only the corrected Attempt, so no earlier row was available to
  compare or preserve; this effort performed no deletion or mutation of an existing Attempt.
- Final review added regression coverage for paginated legacy-property preservation, common
  description URLs, click/status/storage races, stale distinct attempts, Unicode-safe rich text, and
  Difficulty option verification before the release gate.

## Exit criteria

- `npm run check` and `npm run notion:verify` exit successfully in the release state.
- The real workspace contains exactly one Problems database and one Attempts database with the documented reciprocal relation.
- Replaying the fixed sample returns the same page IDs and creates no duplicate Attempt.
- A genuine newly completed LeetCode attempt passes the reviewed one-click acceptance checklist, including exact visible code, expected calendar-date Problem state, and duplicate-free exact retry.
- Extension source and build output contain no Notion credentials or accidental credential material.
- `README.md`, `STATUS.md`, verification evidence, milestone status, and handoff match observed results.
