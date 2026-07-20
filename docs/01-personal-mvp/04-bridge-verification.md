# Slice 04: Bridge verification

Goal: Prove the localhost bridge enforces its narrow contract and writes one idempotent sample capture with the expected real Notion state.

## Remaining checklist

- [ ] Start the bridge on `127.0.0.1` and verify `/health`.
- [ ] Confirm missing and wrong bearer tokens return 401.
- [ ] Confirm invalid and malformed payloads return 400.
- [ ] Send the fixed sample and observe 201 with `duplicate: false`.
- [ ] Replay the identical sample and observe 200 with `duplicate: true` and identical page IDs.
- [ ] Inspect Notion for one Two Sum Problem and one sample Attempt.
- [ ] Confirm Green state, count, dates, reflection, and code body.
- [ ] Record whether natural reconciliation behavior was exercised.
- [ ] Stop the bridge, ship this slice, activate Chrome verification, and rewrite the handoff.

## Record

- 2026-07-20: Activated after exact two-database provisioning passed all schema and inventory checks.
