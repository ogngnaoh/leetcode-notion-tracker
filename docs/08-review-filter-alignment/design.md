# Review Filter Alignment Design

## Goal

Remove the misleading `Hard` queue filter so the local dashboard presents only the date and review-state views that align with its due-review workflow.

## Design

The filter rail will contain `All due`, `Today`, `Overdue`, and `Needed help`. The renderer will stop computing and emitting a Hard count, and the local queue controller will stop recognizing `hard` as a filter value. Individual review rows will continue to show their Easy, Medium, or Hard difficulty badge because difficulty remains useful problem metadata.

The Notion query, due-date cutoff, row ordering, search, 50-row disclosure, responsive layout, capture contract, schema, review schedule, and Notion managed views will not change. This is a presentation-only correction and filters will continue to avoid Notion mutations.

## Verification

Existing renderer and browser checks will be updated first to require four filter controls and no `data-review-filter="hard"`. Per repository policy, the changed tests require user review before first execution. The release will synchronize package, lockfile, and extension versions at `0.1.6`, then run the unchanged `npm run check` and `git diff --check` completion checks.
