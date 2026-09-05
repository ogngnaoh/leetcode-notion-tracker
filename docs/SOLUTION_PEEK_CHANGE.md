# Solution page chips — 2026-09-02

> Historical implementation record. For current operation, use the [documentation index](README.md).

The user approved a single native Solution page chip in the Grind table that opens the saved
Attempt in the current page, instead of redirecting the Problem row's own OPEN button.

## Applied and verified

- Renamed the existing `Grind Open` formula to `Solution`, preserving its property ID.
- The formula returns at most one native Attempt page, using the existing timestamp, creation-time,
  and page-ID tie breakers. It returns an empty list when no saved Attempt exists.
- No solution bodies are copied. Canonical Attempts and Grind-only alias relations are unchanged.
- Verified in Chrome: the Happy Number chip opens its saved Attempt and captured code in a Side Peek
  on Day 1. The page URL retains Day 1 with `p=<attempt-id>&pm=s`; no new tab is created.
- Day 1 has 18 solution chips and two empty cells for problems without saved Attempts.
- Read-back compared all 151 Problem rows with the backup: every non-formula property is unchanged.
  Schema read-back confirms only the existing formula's name/expression changed.
- The Problems database's existing lock was preserved. A temporary personal unlock was re-locked.
- Maintenance supports `Solution` and the legacy name. Version files are synchronized at 0.2.13.
  Other concurrent working-tree changes were preserved; no commit or bridge restart was performed.

## Backup and checks

Before-change backup: `build/notion-latest-preview-1788344353836.json`.
SHA-256: `ffd5eb8a29e8e205594f924a227c84bfe16c68cb8e8390e70604214a82a777f1`.
It contains private solution code; keep it local and ignored.

The connector accepted the formula change but the browser still used the old text expression.
Saving the expression through Notion's formula editor fixed the rendered output. The final native
page-chip behavior and SDK schema read-back both passed.

Two regression tests failed before implementation and passed afterward. Focused maintenance,
cleanup, and schema tests passed. The latest full `npm run check` passed formatting, TypeScript,
481 unit tests (one skipped), the extension build, and 12 dashboard browser tests. The capture browser
suite could not claim port 8787 because it was occupied; the existing process was left running.
The separately run security scan and `git diff --check` passed.

`npm run notion:verify` still stops at the pre-existing database-lock presentation check.
The backup inventory also reported a conflicting receipt on Attempt
`3a6d0127-a66a-817b-a789-c184691a117f`. This display change did not edit or repair any receipts.
That warning is separate from the verified solution-peek behavior and needs its own capture review.
