# Notion maintenance

These commands are optional maintenance for existing trackers, not daily extension setup.
Keep credentials and backups in ignored local files. Keep every tracker writer stopped during
mutating maintenance, including the direct extension and any legacy bridge. Follow the
[cutover and recovery guide](DIRECT_NOTION_CUTOVER.md) before changing writers.

## Schema migrations

If the existing manifest is version 1, first inspect the in-place migration plan:

```bash
npm run notion:migrate:v2
```

Dry-run is the default. It validates the exact v1/intermediate shape, queries every Problems and
Attempts row with pagination, and writes a token-free JSON backup under ignored `build/`, but it
does not mutate Notion or the manifest. After reviewing the printed path, row counts, and plan, apply
the same migration explicitly:

```bash
npm run notion:migrate:v2 -- --apply
```

Apply adds and backfills v2 fields before any deletion. It preserves non-empty removed values in one
`Legacy v1 fields` section on each affected page, verifies the intermediate state, removes obsolete
columns, verifies exact v2, and only then atomically bumps the existing manifest to version 2. It
keeps all database, data-source, page, relation, and unchanged property IDs. Safe retries recognize
the exact intermediate shape and do not duplicate legacy sections; a completed v2 rerun is a no-op.
Before its first mutation, apply atomically writes a token-free recovery journal to
`build/notion-v2-journal.json`. A matching journal preserves the original backup, values, and
backfill expectations across partial backfill, schema deletion, verification, or manifest-write
failures. It is removed only after the version-2 manifest is durable.
Recovery also verifies the journal's SHA-256 binding to the original backup and rejects any extra or
malformed backfill/expected fields before sending a page update.

For an existing version-2 workspace, first review the v2→v3 plan:

```bash
npm run notion:migrate:v3
```

It inventories every Problem and Attempt with pagination, writes a token-free backup, derives the
earliest solved Attempt for every Problem, and reports the `First Solved` backfill
work without mutating Notion. Apply only after reviewing it:

```bash
npm run notion:migrate:v3 -- --apply
```

Apply journals before mutation and advances the manifest only after verification. Manifest version 3
means the `First Solved` schema; the paid Notion dashboard is retired. Inventory it without mutation
using `npm run notion:dashboard:rollback`, then apply after reviewing the token-free backup with
`npm run notion:dashboard:rollback -- --apply`.

`notion:verify` verifies only the current v4 contract. After a v1 or v2 workspace reaches v3, continue
directly through the v4 dry-run and apply steps below, then run `notion:verify`.

For an existing version-3 workspace, review the v3→v4 plan before mutation:

```bash
npm run notion:migrate:v4
```

The dry run paginates all Problems and Attempts, writes a token-free backup, derives each Problem's
earliest Attempt, and inventories the approved `Couldn’t solve` → `Needed help` reclassification.
After reviewing the backup path, counts, and plan, apply and verify explicitly:

```bash
npm run notion:migrate:v4 -- --apply
npm run notion:verify
```

Apply journals before mutation, preserves the `First Solved` property ID while renaming it to
`First Attempt`, backfills earliest timestamps, converts historical rows, removes obsolete options
only after conversion, verifies exact v4 plus untouched row properties and Attempt code bodies, and
then writes manifest version 4. Recovery is accepted only with a strictly validated journal bound to
its original apply backup; an exact completed v4 rerun is a no-op.

### Latest Attempt retention and Grind links

Captures now update the newest existing Attempt page in place, preserving its page link and any
notes outside the managed `Captured code` block. `Needed help` can replace `Solved`: latest means
newest timestamp, not latest successful solution. Older arriving events retain a small retry receipt
but do not replace the current solution. A collapsed managed receipt section preserves retry safety;
do not manually edit that section. Interrupted writes are recovered before the next capture.

Existing historical pages are **not automatically removed**. Prepare a local, token-free backup and
cleanup preview with:

```bash
npm run notion:latest
```

The backup includes all Attempt page bodies (including nested blocks), properties, Problem properties,
schema, selected survivors and compact event receipts. Review it before separately approving cleanup.
This command has no page-deletion mode.

After separately approving the preview, keep every tracker writer stopped and pass that backup and its printed
SHA-256 to the dedicated cleanup command:

```bash
npm run notion:latest:cleanup -- --backup build/notion-latest-preview-<timestamp>.json --sha256 <digest>
```

Cleanup recomputes the backed-up plan, rejects changed targets or older pages with extra notes,
preserves and verifies compact receipts on retained pages, and only then moves the approved older
pages to Notion Trash. It never permanently deletes them. Page IDs, current solutions, first-attempt
dates, review state and Grind settings stay intact; reciprocal relations shed the trashed pages.
Keep the backup and local audit. If interrupted, rerun with the same backup/hash: already-preserved
receipts and trashed pages are recognized without expanding the deletion set. Stop for new approval
if captures or other changes invalidate that backup.

To update existing Grind links after a fresh backup:

```bash
npm run notion:latest -- --apply-grind-link
```

This updates `Solution` (or the legacy `Grind Open` property) to a native Attempt page chip and adds
a one-way `Grind Attempt` relation only for
Grind-only duplicate checklist rows. It preserves canonical capture relations, checkbox state,
day/block assignments and reset buttons. Click the chip to peek at the saved code within Notion.
Rows without a saved attempt have an empty solution cell; no external-tab fallback is used.
Timestamp ties use creation time, then stable page ID; ambiguous differing bodies are flagged.
If Notion rejects the relation formula through its API, paste `GRIND_OPEN_FORMULA` from
`src/notion/latest-attempt-maintenance.ts` into the existing `Solution` / `Grind Open` formula editor in Notion,
then rerun the command. A successfully saved identical formula is verified without rewriting it.
Keep the extension locked during maintenance; this command does not resume captures.

Outcome saves reuse a request-local Notion snapshot and combine Problem metadata/review updates.
With one page of receipts, a normal replacement uses 10 Notion requests (previously 21); first
captures use 6. Success still means the Notion writes finished, not merely that work was queued.
Retries reload durable state, and pending receipts remain until both the Attempt and Problem are
updated. Notion latency, retries, and extra pages of notes/receipts still affect elapsed time.
