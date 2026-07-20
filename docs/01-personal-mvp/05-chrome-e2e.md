# Slice 05: Chrome end to end

Goal: Verify the unpacked extension captures live LeetCode metadata and safely retries one user-confirmed Medium attempt into the real tracker.

## Remaining checklist

- [ ] Build and load `dist/extension`; configure localhost, the bridge token, and Python.
- [ ] Verify Two Sum metadata and `longest-substring-without-repeating-characters` metadata.
- [ ] Verify client-side navigation without closing the LeetCode tab.
- [ ] Verify a non-LeetCode tab is rejected clearly.
- [ ] Verify missing and wrong bridge-token handling.
- [ ] Confirm no capture occurs before pressing `Log attempt`.
- [ ] Stop the bridge, submit the populated Medium attempt, and confirm fields lock with `Retry same attempt`.
- [ ] Restart the bridge and retry the retained exact event.
- [ ] Confirm exactly one live Medium Attempt and correct Problem state in Notion.
- [ ] Stop the bridge, record evidence, ship this slice, activate release, and rewrite the handoff.

## Record

- 2026-07-20: Activated after the fixed bridge sample passed authentication, validation, replay, and real Notion inspection.
