# Milestone 02: Deliberate Daily Launcher

Goal: Ship a visible one-click iTerm2 launcher so the owner can deliberately start every local
runtime needed by the extension after login without moving the Notion token into Chrome.

## Scope

- Start the existing localhost bridge from a Dockable `.command` file.
- Keep the bridge visibly attached to an iTerm2 session and stop it with that session.
- Refuse duplicate startup and unknown port conflicts without killing processes.
- Preserve the current bridge API, extension behavior, Notion schema, and local secret boundary.
- Document the one-time iTerm2 association and Dock setup.

## Non-goals

- Automatic login startup, LaunchAgents, hidden daemons, or background notifications.
- Cloud hosting, native messaging, or direct Notion access from the extension.
- Opening LeetCode or extension settings from the launcher.
- Changing capture, retry, scheduling, migration, or idempotency behavior.

## Slices

1. **Visible iTerm2 bridge launcher** — shipped — add the tested foreground coordinator, Dockable
   command file, daily-use instructions, and independent manual acceptance.

## Integration notes

- The owner approved one deliberate click after login and a visibly running iTerm2 window.
- `.command` files will be associated with `/Applications/iTerm.app` once, then the launcher will be
  placed in the Dock's document area.
- The launcher resolves the repository from its own path and uses the configured bridge port.
- An atomic temporary startup claim prevents two pre-bind clicks from spawning competing bridges and
  safely recovers claims whose owning process is gone.
- The Notion token remains only in the ignored local `.env`; no extension storage or permissions change.
- Tests written in this milestone are development evidence, not independent verification.

## Exit criteria

- One Dock click starts the bridge visibly in iTerm2 with actionable status.
- A second click does not create another bridge; an unknown port owner is never terminated.
- Ctrl-C stops the bridge, the extension becomes unavailable, and one later click restores service.
- Fresh project checks, Notion verification, security scan, and whitespace checks pass.
- README, status, architecture, manual QA, verification record, slice record, and handoff agree.
