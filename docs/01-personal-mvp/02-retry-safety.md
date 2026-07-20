# Slice 02: Retry safety and secret-safe errors

Goal: Make uncertain extension retries reuse the exact capture event while keeping bridge failures actionable and free of credential leakage.

## Remaining checklist

- [x] Add focused coordinator tests for success, uncertain retry reuse, and definitive rejection clearing.
- [x] Add API tests for response validation and failure classification.
- [x] Add a focused bridge-route test for fixed client messaging and bounded, redacted diagnostics.
- [x] Run the new tests and confirm they fail for the intended missing behavior.
- [x] Obtain user review of the new tests before production changes.
- [x] Implement `CaptureRequestError` and `CaptureSubmissionCoordinator` minimally.
- [x] Integrate classified API errors and pending retry state into the side panel.
- [x] Implement fixed bridge 500 responses and bounded, redacted diagnostic logging.
- [x] Run focused tests, then the unchanged `npm run check`.
- [x] Record evidence, ship this slice, activate Notion provisioning, and rewrite the handoff.

## Record

- 2026-07-20: Activated after a fresh green baseline with 15 existing tests.
- 2026-07-20: Added ten focused tests. The coordinator suite failed because `capture-submission.ts` did not exist; route tests showed malformed JSON returned 500 and raw synthetic credential-bearing errors reached the response and console.
- 2026-07-20: The user reviewed and approved the new tests while red, before production changes.
- 2026-07-20: Added an in-memory submission coordinator, classified request errors, validated successful responses, retained and locked uncertain retries, and added fixed client-safe bridge failures with bounded redacted diagnostics.
- 2026-07-20: Focused tests passed 13/13. The unchanged `npm run check` passed formatting, TypeScript, 25/25 tests, the extension build, and the existing security scan.
- 2026-07-20: Replaced the initial runtime Zod import with a narrow response guard after the build exposed a 539.1 KB side-panel bundle; the final build was 7.9 KB.
