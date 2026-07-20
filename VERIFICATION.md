# Verification record

Verified from the Milestone 02 release tree on July 20, 2026.

## Fresh release gates

```text
npm run check          → passed
  Prettier             → passed
  TypeScript           → passed
  Vitest               → 20 files, 241 tests passed
  MV3 Playwright       → 16 tests passed
  extension build      → passed
  security scan        → passed
npm run notion:verify  → Problems 13 properties; Attempts 13 properties; compatible
npm run security:scan  → no Notion-token-shaped values in Git files or dist/extension
git diff --check       → passed
```

The tests and browser fixture changed during implementation and are development evidence. Final
read-only review found no unresolved Critical or Important findings.

## Independent daily-launcher evidence

Finder reported `iTerm (default)` for `.command` files, and the Dock preference contained the tracked
`Start LeetCode Tracker.command` file in its document area. Opening that exact Finder item created one
visible iTerm2 launcher process and returned the exact health identity
`{"ok":true,"service":"leetcode-notion-bridge"}` from `127.0.0.1:8787`.

A second launch reported the existing bridge without creating another listener. Ctrl-C removed the
listener; a later launch restored it. With a harmless unrelated listener temporarily holding port 8787,
the launcher refused startup, printed the exact `lsof` inspection command, and left that listener alive.
The test listener and every launcher-owned bridge were stopped afterward.

The focused launcher checks changed during this work and are development evidence. Independent review
identified a pre-bind double-click race; the final atomic claim implementation passed follow-up review
with no unresolved Critical or Important findings.

## Independent live evidence

After reloading the unpacked extension, the owner's Chrome side panel recognized Valid Sudoku without
editor focus, scrolling, or a page refresh. It showed number/title, Medium difficulty, all three topic
links, Python, expanded rendered lines 1–9, and active equal outcome controls.

One truthful `Couldn’t solve` click created Client Event ID
`8318f850-d922-49a3-9e6a-37af14d9c492`. Read-only Notion inspection confirmed one immutable Attempt,
the exact rendered code body, and canonical Problem state `Couldn’t solve`, solved streak 0, next review
`2026-07-20`. Replaying the identical event returned `duplicate: true`, the same Attempt page ID, and
left the Attempt count at one.

The complete post-capture inventory contained no earlier Valid Sudoku Attempt, despite the plan's
assumption that one existed. No existing Attempt was modified or deleted. The bridge was stopped,
Playwright exited, browser control was released, review agents completed, and no visual-companion
process was started.

## Remaining manual item

Create the optional Notion UI view with `Next Review on or before Today`, sorted ascending. Public API
view management is unsupported and is intentionally not part of the release automation.
