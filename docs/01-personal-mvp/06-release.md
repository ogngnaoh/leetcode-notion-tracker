# Slice 06: Release

Goal: Close the personal MVP with fresh automated gates, real workspace verification, independent
Chrome-to-Notion evidence, and an accurate Sustain handoff.

## Scope

- Run the complete project check and the real Notion schema verifier from the release tree.
- Run the security scan and whitespace check independently.
- Record the final code-review disposition and live acceptance evidence.
- Mark this slice and milestone shipped in a separate documentation commit.

## Non-goals

- Managing Notion views (subsequently added through the supported API in Milestone 03).
- Adding cloud hosting, an offline queue, OAuth, or another tracker schema.
- Performing another real capture after the accepted Valid Sudoku write.

## Checklist

- [x] Final review reported no unresolved Critical or Important findings.
- [x] `npm run check` passed from the release tree.
- [x] `npm run notion:verify` passed against the real v2 workspace.
- [x] `npm run security:scan` passed independently.
- [x] `git diff --check` passed.
- [x] Live Chrome capture and exact Client Event ID replay were inspected in Notion.
- [x] Bridge and browser-test processes were stopped; browser control was released; review agents
      completed; no visual-companion process was started.
- [x] Release evidence, milestone status, status, verification record, and handoff were updated.

## Release evidence

On 2026-07-20, the fresh `npm run check` passed Prettier, TypeScript, 19 Vitest files with 223 tests,
the extension build, 16 single-worker MV3 Playwright scenarios, and the secret scan. A separate
`npm run security:scan` reported no Notion-token-shaped values in Git files or `dist/extension`, and
`git diff --check` produced no errors.

`npm run notion:verify` contacted the configured real workspace and verified 13 exact v2 Problems
properties and 13 exact v2 Attempts properties. Final read-only review found no unresolved Critical
or Important issue after regression fixes for migration pagination, stale event ordering, Unicode
chunking, description routes, capture lifecycle races, and schema option verification.

Independent acceptance used the owner's Chrome and real Notion workspace. Without focusing or
scrolling the Valid Sudoku editor, the side panel recognized #36, Medium, Array/Hash Table/Matrix,
Python, and rendered lines 1–9. The truthful `Couldn’t solve` click created Client Event ID
`8318f850-d922-49a3-9e6a-37af14d9c492`, stored the exact rendered code, and set the canonical Problem
to `Couldn’t solve`, streak 0, next review `2026-07-20`. Exact replay returned `duplicate: true` with
the same Attempt page ID and left the count at one.

The approved plan expected an earlier Valid Sudoku Attempt, but the complete post-capture inventory
contained only the accepted Attempt. No pre-existing Attempt was available to compare or preserve,
and this work deleted none. Tests created or changed in this effort remain development evidence; the
real Chrome/Notion observations are the independent acceptance evidence.
