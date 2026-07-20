# Milestone 01: Personal LeetCode → Notion MVP

Goal: Ship a reliable personal Chrome-to-local-bridge-to-Notion workflow so one user can log confirmed LeetCode attempts without exposing Notion credentials or creating duplicates.

## Scope

- Establish a reproducible local baseline and Sustain evidence trail.
- Preserve exactly two Notion databases: Problems and Attempts.
- Retain the exact capture event across uncertain extension retries.
- Return actionable, secret-safe bridge failures.
- Provision and verify the real Notion schema once.
- Verify bridge idempotency and Chrome capture end to end.
- Produce fresh release checks, security scans, and observed evidence.

## Non-goals

- Cloud hosting, OAuth, user accounts, or a second application database.
- A generalized Notion proxy, schema mapper, migration framework, or offline queue.
- Private LeetCode APIs, cookies, request interception, crawling, or automatic submission logging.
- React, Next.js, a monorepo framework, an ORM, or Docker.

## Slices

1. **Baseline and tracking** — shipped — initialized local Git, restored the corrected public-registry lockfile, passed the unchanged project check, and committed the scaffold plus milestone records.
2. **Retry safety and secret-safe errors** — shipped — uncertain failures retain the exact in-memory event, retry fields lock, responses are validated and classified, and bridge diagnostics are bounded and redacted.
3. **Real Notion provisioning** — active — create and verify exactly two databases and a secret-free manifest.
4. **Bridge verification** — pending — verify health, authentication, validation, duplicate replay, reconciliation, and Notion state.
5. **Chrome end to end** — pending — verify live metadata, explicit confirmation, retained retry, and one live Medium capture.
6. **Release** — pending — run fresh checks and scans, update observed evidence, ship the milestone, and commit release documentation.

## Integration notes

- The approved implementation sequence is baseline → retry safety → Notion → bridge → Chrome → release.
- Existing `External Key` and `Client Event ID` behavior remains the idempotency contract.
- Tests added during this milestone are development status evidence, not independent verification.
- The unchanged `npm run check`, real schema inspection, duplicate sample replay, live Chrome capture, and secret scan are the completion evidence.
- The original lockfile contained 116 sandbox-internal `resolved` URLs. They were rewritten to `https://registry.npmjs.org/` without changing pinned versions or integrity hashes; a fresh `npm ci` then restored 61 packages with zero reported vulnerabilities.
- The user reviewed the retry-coordinator, API-classification, malformed-JSON, and secret-safe route tests after their expected red runs and before production changes.
- Runtime schema validation was kept out of the extension bundle; a narrow success-response guard preserves the contract while keeping the built side panel at 7.9 KB.

## Exit criteria

- `npm run check` and `npm run notion:verify` exit successfully in the release state.
- The real workspace contains exactly one Problems database and one Attempts database with the documented reciprocal relation.
- Replaying the fixed sample returns the same page IDs and creates no duplicate Attempt.
- A live Chrome capture succeeds after user confirmation, including an uncertain failure followed by retry of the exact event.
- Extension source and build output contain no Notion credentials or accidental credential material.
- `README.md`, `STATUS.md`, verification evidence, milestone status, and handoff match observed results.
