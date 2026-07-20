# Slice 02: Retry safety and secret-safe errors

Goal: Make uncertain extension retries reuse the exact capture event while keeping bridge failures actionable and free of credential leakage.

## Remaining checklist

- [ ] Add focused coordinator tests for success, uncertain retry reuse, and definitive rejection clearing.
- [ ] Add API tests for response validation and failure classification.
- [ ] Add a focused bridge-route test for fixed client messaging and bounded, redacted diagnostics.
- [ ] Run the new tests and confirm they fail for the intended missing behavior.
- [ ] Obtain user review of the new tests before production changes.
- [ ] Implement `CaptureRequestError` and `CaptureSubmissionCoordinator` minimally.
- [ ] Integrate classified API errors and pending retry state into the side panel.
- [ ] Implement fixed bridge 500 responses and bounded, redacted diagnostic logging.
- [ ] Run focused tests, then the unchanged `npm run check`.
- [ ] Record evidence, ship this slice, activate Notion provisioning, and rewrite the handoff.

## Record

- 2026-07-20: Activated after a fresh green baseline with 15 existing tests.
