# Slice 04: Bridge verification

Goal: Prove the localhost bridge enforces its narrow contract and writes one idempotent sample capture with the expected real Notion state.

## Remaining checklist

- [x] Start the bridge on `127.0.0.1` and verify `/health`.
- [x] Confirm missing and wrong bearer tokens return 401.
- [x] Confirm invalid and malformed payloads return 400.
- [x] Send the fixed sample and observe 201 with `duplicate: false`.
- [x] Replay the identical sample and observe 200 with `duplicate: true` and identical page IDs.
- [x] Inspect Notion for one Two Sum Problem and one sample Attempt.
- [x] Confirm Green state, count, dates, reflection, and code body.
- [x] Record whether natural reconciliation behavior was exercised.
- [x] Stop the bridge, ship this slice, activate Chrome verification, and rewrite the handoff.

## Record

- 2026-07-20: Activated after exact two-database provisioning passed all schema and inventory checks.
- 2026-07-20: Started the bridge on `127.0.0.1:8787`; health returned 200, missing and wrong tokens returned 401, and invalid plus malformed payloads returned 400.
- 2026-07-20: The fixed sample returned 201 with `duplicate: false`; its identical replay returned 200 with `duplicate: true` and identical Problem and Attempt page IDs.
- 2026-07-20: Read-only Notion inspection found exactly one Two Sum Problem and one sample Attempt with Green count 1, expected attempt and review dates, reciprocal page link, reflection, and complete code body.
- 2026-07-20: No post-Attempt Problem-update failure occurred naturally, so reconciliation through that failure path was not exercised during the live sample.
- 2026-07-20: Stopped the bridge before shipping the slice.
