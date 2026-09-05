# Notion schema contract

The shared tracker repository expects exact v4 property names and types. This is intentional: a personal tracker does
not need a generalized field-mapping engine. There are exactly two databases with reciprocal
`Problem`/`Attempts` relations.

## LeetCode Problems

One row is one canonical LeetCode problem.

| Property          | Type         | Meaning                                  |
| ----------------- | ------------ | ---------------------------------------- |
| Problem           | Title        | Display title                            |
| External Key      | Rich text    | Stable `leetcode:<slug>` idempotency key |
| Slug              | Rich text    | LeetCode slug                            |
| Number            | Number       | Problem number when available            |
| URL               | URL          | Canonical problem URL                    |
| Difficulty        | Select       | Easy, Medium, Hard, or Unknown           |
| Topics            | Multi-select | Visible LeetCode topic labels            |
| Practice State    | Select       | New, Needed help, Solved, or Mastered    |
| Solved Streak     | Number       | Consecutive solved count, capped at 5    |
| Next Review       | Date         | Browser-local calendar date or null      |
| Last Attempt      | Date         | Most recent attempt timestamp            |
| First Attempt     | Date         | Earliest related Attempt timestamp       |
| Extension Managed | Checkbox     | Created by this integration              |
| Attempts          | Relation     | Reciprocal relation to Attempts          |

Pre-seeded Grind rows can have a null Practice State and Solved Streak before the first capture.
The repository reads these as `New` / `0` only when First Attempt, Last Attempt and Next Review are
also null. A missing Difficulty reads as `Unknown`. Reads never fill these values in Notion;
the user's next confirmed capture updates the existing row, preserving Grind controls and links.
Partially populated review state remains an error rather than resetting existing progress.

## LeetCode Attempts

One retained row is the latest captured Attempt for a canonical problem key. Its page ID stays stable
across captures. Legacy historical rows remain until an explicitly approved cleanup.

| Property                | Type         | Meaning                                    |
| ----------------------- | ------------ | ------------------------------------------ |
| Attempt                 | Title        | Problem plus attempt timestamp             |
| Client Event ID         | Rich text    | UUID used for idempotency                  |
| Problem                 | Relation     | Canonical Problem row                      |
| Problem Key             | Rich text    | Redundant `leetcode:<slug>` key            |
| Attempted At            | Date         | Attempt timestamp at Notion date precision |
| Source URL              | URL          | LeetCode problem URL                       |
| Language                | Rich text    | Visible implementation language            |
| Result                  | Select       | Needed help or Solved                      |
| Resulting State         | Select       | State applied to the Problem               |
| Resulting Solved Streak | Number       | Solved streak applied to the Problem       |
| Resulting Next Review   | Date         | Calendar date applied to the Problem       |
| Extension Managed       | Checkbox     | Created by this integration                |
| Created Time            | Created time | Native Notion timestamp                    |

Difficulty options use green `Easy`, yellow `Medium`, red `Hard`, and gray `Unknown`. State options
use gray `New`, yellow `Needed help`, green `Solved`, and blue `Mastered`.
`Result` uses yellow `Needed help` and green `Solved`.

Captured code is written in the Attempt page body under `Captured code`.

The page gains a collapsed `LCTrack retry receipts — managed` toggle on its first replacement,
or at creation when the capture timestamp includes seconds or milliseconds.
Each JSON code block stores one version-1 receipt: `clientEventId`, `attemptedAt`, `result`, and
`review`. A `pending` capture payload remains until both the Attempt and Problem writes finish. Never
manually edit these blocks; they replace immutable history as the retry/recovery record. Completed
receipts contain no historical solution code. `Client Event ID` remains the current event's UUID.
`First Attempt` means the earliest recorded capture, even after older Attempt pages are removed.
Notion date properties can truncate timestamps to the minute. Write verification accepts only the
exact instant or that minute-truncated representation. Receipts preserve exact capture timestamps
for ordering within a minute; legacy pages without a receipt retain their available date precision.

Existing Grind workspaces may additionally contain exactly these optional Problem properties:
`Grind Day` (select), `Grind Block` (select), `Grind Order` (number), `Grind Done` (checkbox),
`Solution` (formula, formerly `Grind Open`, whose legacy name is still accepted), and
`Grind Attempt` (one-way relation to Attempts). The last field links
Grind-only duplicate checklist rows without changing the canonical Attempt's `Problem` relation.
The shared formula chooses the latest related Attempt by timestamp, creation time, then page ID,
and returns a single native page chip for an in-place peek, or an empty list when no saved Attempt
exists. It does not generate URL links or copy solution bodies. Fresh setup does not create
Grind scaffolding. Required v4 properties and the two-database boundary are unchanged.

## v1→v2 migration contract

`npm run notion:migrate:v2` is dry-run by default and requires `--apply` for Notion mutations. Both
modes query every row and every potentially paginated legacy property with pagination, then write a
token-free JSON backup under ignored `build/`.
Apply adds and backfills v2 fields, appends one non-duplicated `Legacy v1 fields` section wherever a
removed value is non-empty (including `false` and `0`), verifies the intermediate union, removes the
obsolete properties, verifies exact v2, and atomically updates the existing manifest to version 2.
The original non-empty timestamp of the shared `Resulting Next Review` property is also preserved in
the backup and legacy section before its value is converted to `YYYY-MM-DD`; the property itself is
not removed.

Before the first mutation, apply atomically writes `build/notion-v2-journal.json`. The token-free
journal binds the original backup, manifest/API IDs, starting shapes, page IDs, original legacy
values, and expected backfill values. Recovery uses that journal rather than converted live values,
repairs any missing exact legacy labels, verifies their paginated read-back, and removes the journal
only after the version-2 manifest is durable.
Recovery rejects extra or malformed backfill/expected keys and verifies both a stored SHA-256 digest
and the exact structured content of the original backup before any Notion mutation.

The migration keeps existing database, data-source, page, relation, and unchanged property IDs and
refuses unknown shapes before mutation. Exact intermediate retries do not duplicate legacy sections;
an exact v2/version-2 rerun is a no-op.

## Database presentation and managed views

Problems uses the 🧩 icon and “Current practice state and review schedule. Managed by LC Log.”
Attempts uses the 📝 icon and “Immutable history of confirmed practice attempts. Managed by LC
Log.” This is legacy presentation text; current captures retain one stable latest Attempt page
per problem, as described above. The strict CLI presentation verifier expects neither database to
have a cover or lock. Sidebar Connect verifies schema and bindings without this presentation gate;
a CLI presentation failure alone does not establish whether row writes are permitted.

Problems has `Review queue` (due on/before today, then review date/title ascending) and `All
problems` (number/title ascending). Attempts has `Recent attempts` (attempt timestamp descending).
The setup and verifier share the exact visible-property order, widths, wrapping, relative review-date
format, 12-hour attempt timestamps, frozen title column, disabled subtasks, and hidden vertical lines.
Technical properties remain in the schema but are hidden in these views. Unrelated views are allowed.

The former `Daily plan` was retired because it required a Notion Business plan. Review happens
directly in Notion; the extension has Daily Reps and Log tabs. The optional legacy dashboard can
still read these properties without another database, relation, or property.

## v2→v3 migration contract

`npm run notion:migrate:v3` is dry-run by default. It paginates every Problem and Attempt, writes a
token-free backup, and derives `First Solved` solely from the earliest Attempt whose Result is
`Solved`. Apply journals before mutation, backfills and verifies the property, and only then
atomically advances the manifest to version 3.

## v3→v4 migration contract

`npm run notion:migrate:v4` is dry-run by default. It paginates every Problem and Attempt, writes a
token-free backup, and derives `First Attempt` from the earliest related `Attempted At` timestamp.
Apply journals before mutation, renames `First Solved` in place, backfills earliest timestamps,
reclassifies historical `Couldn’t solve` Problem and Attempt values to `Needed help`, and removes the
obsolete options only after every row is converted. It preserves review dates, streaks, IDs,
relations, timestamps, code bodies, and Client Event IDs, verifies exact v4, and only then atomically
advances the manifest to version 4. A completed exact-v4 rerun is a no-op.

## Compatibility rule

Renaming, adding, removing, or changing the type of a required property breaks the exact contract.
Run `npm run notion:verify` after the migration and after any manual schema edit.
