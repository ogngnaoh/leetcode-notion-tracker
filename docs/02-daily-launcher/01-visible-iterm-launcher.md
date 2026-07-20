# Slice 01: Visible iTerm2 Bridge Launcher

Goal: Provide a deliberate Dock click that starts the existing production bridge in a visible iTerm2
session and makes its entire lifetime obvious to the owner.

## Remaining checklist

- [x] Add focused failing tests for startup decisions, prerequisites, child lifecycle, and launcher metadata.
- [x] Implement a testable foreground bridge-launch coordinator.
- [x] Add the executable repository-relative iTerm2 `.command` launcher.
- [x] Document one-time iTerm2 association, Dock setup, daily startup, and shutdown.
- [x] Request final code review and address Critical or Important findings.
- [x] Complete the manual click/start/duplicate/stop/restart acceptance.
- [x] Run fresh automated, Notion, security, and whitespace gates.
- [x] Ship this slice and milestone in one commit.

## Record

- 2026-07-20: Activated from the owner-approved design. The launcher is manual, visible, local-only,
  iTerm2-specific, bridge-only, and must not change extension or Notion contracts.
- 2026-07-20: Added the pure coordinator, executable launcher, prerequisite and exact-health checks,
  signal forwarding, exact port diagnostics, and an atomic startup claim with dead-owner recovery.
- 2026-07-20: Associated `.command` files with iTerm2 and added the tracked launcher to the Dock.
  Finder launch returned the exact bridge health identity; duplicate, stop, restart, and unknown-port
  behavior passed without terminating an unrelated listener.
- 2026-07-20: Review found a pre-bind double-click race. The atomic claim and concurrent-launch test
  resolved it; follow-up review reported no unresolved Critical or Important findings.
- 2026-07-20: Fresh release gates passed: formatting, TypeScript, 241 Vitest tests, 16 MV3 browser
  scenarios, extension build, security scan, exact 13/13-property Notion schema verification, and
  `git diff --check`.
