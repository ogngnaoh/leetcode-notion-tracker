# LCTrack

A personal Chrome extension for daily LeetCode repetitions, confirmed Notion saves, and a compact
review queue. Notion connects directly from the extension: no running bridge or hosted service.

The default workflow is standalone:

1. Open a LeetCode problem.
2. Open the Chrome side panel.
3. Set a goal once, then select **Log rep** after each question.
4. Finish and archive the session manually when the day is done.

The **Log** tab saves an attempt only after you choose an outcome. **Review** shows the current
Notion review queue in the same sidebar. Connection and recovery controls live in **Settings**.

## Why this shape

- **Two Notion databases:** one current `Problem` record and one stable latest `Attempt` page per problem key.
- **Standalone daily reps:** repeated questions count independently in browser-local extension data.
- **Local encrypted connection:** save your token encrypted with a passphrase; unlock once per Chrome session.
- **Exact schema:** the extension is for this personal tracker, not every arbitrary Notion database.
- **Manual confirmation:** code and attempt writes require choosing `Needed help` or `Solved`.
- **No provisioning framework:** one setup command creates the databases once.

## Repository layout

```text
src/shared/       Capture contract, stable keys, review schedule
src/notion/       One-time setup, migrations, safe dashboard rollback, and exact verification
src/tracker/      Portable capture, repository, review, and receipt logic
src/bridge/       Legacy local bridge adapters and maintenance dashboard
extension/        Manifest V3 side-panel extension
scripts/          Extension build script
test/             Unit and bridge route tests
docs/             Architecture, schema, security, and manual QA
```

## Prerequisites

- Node.js 22+
- Chrome 142+
- Playwright's bundled Chromium (`npx playwright install chromium`) for `npm run check`
- A Notion workspace
- A Notion internal integration with read, insert, and update content capabilities
- One empty Notion page shared with that integration

## 1. Install

```bash
npm install
cp .env.example .env
```

The `.env` file is used only by the one-time setup and advanced maintenance commands. An existing
v4 tracker can skip setup and import its token-free manifest in the sidebar. Never import `.env`
into the extension. For CLI setup, fill in `.env`:

```dotenv
NOTION_TOKEN=ntn_...
NOTION_PARENT_PAGE_ID=...
NOTION_MANIFEST_PATH=build/notion-manifest.json
BRIDGE_TOKEN=<at least 24 random characters>
PORT=8787
DAILY_NEW_PROBLEM_GOAL=10
```

The parent page ID is the ID from the empty Notion page where the two databases should be created.

## 2. Create or migrate the tracker in Notion

```bash
npm run notion:setup
npm run notion:verify
```

`notion:setup` creates manifest/schema version 4 directly, including:

- `LeetCode Problems`
- `LeetCode Attempts`
- A two-way relation between them
- LC Log presentation and the managed review/all/recent views
- `build/notion-manifest.json` containing non-secret database and data-source IDs

The command refuses to run when the manifest already exists, preventing accidental duplicate databases.

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

## 3. Prepare an existing tracker for direct connection

Resolve any pending saves in the old extension before reloading it. Stop the legacy bridge and
keep only one writer profile for this tracker. Preserve the existing token-free
`build/notion-manifest.json` and optional `build/dashboard-settings.json`; the latter keeps your
Notion goal and exact count-reset timestamp. Follow [the cutover guide](docs/DIRECT_NOTION_CUTOVER.md).

## 4. Build and load the Chrome extension

```bash
npm run build:extension
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `dist/extension`.
5. Open a page matching `https://leetcode.com/problems/<slug>/`.
6. Select the extension icon to open the side panel.
7. Set a Daily Reps goal and log the current question as often as needed.
8. For Notion, open the sidebar **Settings**, import the v4 manifest and optional preferences,
   enter a dedicated integration token, and choose a passphrase of at least 16 characters.
   Confirm the import preview, then connect. Connection verification performs no Notion writes.
9. Optional: assign a keyboard shortcut at `chrome://extensions/shortcuts` (see below).

Chrome’s **Extension options** page is a launcher for sidebar Settings. It contains no credential
form. Keep your integration shared only with the two tracker databases and their contents.

The extension icon can open LCTrack from any tab, but the panel belongs only to the tab where it was
clicked. Moving to another tab does not carry the side panel with it; click the icon there if you also
want LCTrack on that tab.

### Keyboard shortcut

LCTrack declares a **Toggle LCTrack side panel** command but ships no default key, so Chrome installs
it unassigned. Give it one at `chrome://extensions/shortcuts` — LCTrack's row is blank until you do,
and nothing about the extension changes if you never do. The key toggles: press it to open the panel
for the current tab, press it again to close that panel. (LCTrack's other row on that page,
**Activate the extension**, is one Chrome adds to every extension; leave it unset.)

The toolbar icon still only opens. Toggling needs to know whether a panel is already open, which the
icon path has no reason to track.

No default is shipped on purpose. A default would be claimed browser-wide the moment the extension
loads, and the obvious candidates are already taken on the pages LCTrack targets: LeetCode's editor
is Monaco, where <kbd>Cmd/Ctrl+Shift+L</kbd> is select-all-occurrences and <kbd>Cmd/Ctrl+Shift+K</kbd>
is delete-line. Chrome hands the keystroke to the extension before the page sees it, so a default
would silently disable whichever editor command it shadowed.

When picking a key, note that Chrome's shortcut field only accepts <kbd>Ctrl</kbd> or <kbd>Alt</kbd>
(<kbd>Command</kbd> or <kbd>Option</kbd> on macOS), optionally plus <kbd>Shift</kbd>, plus one more
key. It silently refuses plain letters, bare function keys, and combinations Chrome reserves — and
it will not record a combination another extension already holds.

Once bound, the key acts on the active tab, with one exception: Chrome does not deliver extension
shortcuts on its own pages (the New Tab page, `chrome://*`, the Web Store), where the icon still
works.

The toggle requires **Chrome 142 or newer** — it tracks panel state from `sidePanel.onOpened` and
`sidePanel.onClosed`, and the latter landed in 142. That is why `minimum_chrome_version` moved up
from 116.

Because this project is installed unpacked, Chrome derives the extension's identity from the load
path. Keep the checkout where it is — loading from a different directory registers a fresh extension
with a blank shortcut, and you would assign it again.

## Daily use

1. Open a LeetCode problem and open LCTrack. **Daily Reps** is always the initial tab.
2. Set or edit the 1–100 goal. Each **Log rep** click appends one timestamped local entry, including
   repeated clicks for the same problem.
3. Remove mistaken current entries if needed, then select **Finish & reset** to archive the session.
   The goal carries forward; sessions never reset automatically at midnight.
4. Expand **History** to inspect locally archived problems. This history is profile-local, is not
   synced, and is removed if Chrome clears the extension's data or the extension is uninstalled.

For Notion, unlock in Settings, open **Log**, and confirm `Needed help` or `Solved`. The worker
can stop and restart without requiring another unlock during the same Chrome session. Fully exiting
Chrome, reloading, updating, or disabling the extension clears the unlock key. Closing the last
window may leave Chrome running; use **Lock now** when you want to lock immediately.

**Review** loads when opened or explicitly refreshed. Daily Reps and idle panels make no Notion
requests. Review preferences are separate from the Daily Reps goal; resetting the new-problem count
changes only a local timestamp, not Notion records.

The saved token and pending code are encrypted locally. While unlocked, the extension holds the
usable key in session storage. This protects a copied locked profile subject to passphrase strength;
it cannot protect a compromised browser, operating system, or malicious extension update. See the
[security model](docs/SECURITY-MODEL.md).

On panel startup, the extension reads the problem page without focusing or scrolling LeetCode.
Recognition also works on Accepted/submission, Solutions, and Editorial routes. When LeetCode keeps
Description mounted behind another tab, metadata is read from that pane only after its title link
matches the current problem slug. Opening the panel does not switch LeetCode tabs or focus its editor.
Problem metadata comes from the public DOM:

- Problem slug
- Problem title and number when available
- Canonical URL
- Difficulty when available
- Topic links in the current description, including those below the viewport or in its inactive pane

Code comes from the active Monaco or CodeMirror editor model, read by a second content script running
in the page's own JavaScript world. Both models hold the entire buffer regardless of how much the
editor has rendered, so a solution longer than the editor viewport is captured in full rather than
truncated to visible lines. Monaco supplies its model language id; focus mode supplies the language
on the scoped CodeMirror editor element. Rendered editor text is never used as a capture fallback.

The code disclosure starts expanded. When no editor model can be read, the panel reports code
unavailable and blocks capture rather than logging a fragment; it recovers automatically once the
editor finishes hydrating. Requests carry a small protocol version so an extension reload cannot use
a stale content script or page-world reply. If the current receiver is missing or stale, the panel
reinjects both scripts once and retries immediately.

Each deliberate outcome click creates a new Client Event ID and updates the stable latest Attempt,
even when code is unchanged. One encrypted pending save is shared across all panels. An interrupted
save keeps its original code, timestamp, and ID even if you navigate away. Use **Check saved result**
when verification is required, then **Retry same attempt** to finish. Neither unlocking nor worker
startup submits a save. An empty Notion lookup does not prove a previous write failed; ambiguous
results remain blocked for inspection instead of risking a duplicate.

Review scheduling is intentionally small:

| Result             | New state / solved streak | Next review      |
| ------------------ | ------------------------- | ---------------- |
| Needed help        | Needed help / 0           | Same day         |
| Solved, streak 1–4 | Solved / 1–4              | 1, 3, 7, 14 days |
| Solved, streak 5   | Mastered / 5              | None             |

The managed Notion views are `Review queue`, `All problems`, and `Recent attempts`.
Before the first manual reset, the sidebar Review view counts each Problem once on
`First Attempt = today` for backward compatibility. After reset, it counts immutable First Attempts
strictly after the saved session boundary and shows `NEW PROBLEMS THIS SESSION`; the configurable
maximum is an inline button beside the count. Review includes the explicit count reset; Settings
manages the connection and recovery. The compact review queue uses direct LeetCode URLs and includes every Problem whose `Next Review` is today or
earlier and defensively excludes future-dated rows even if an upstream response contains one. Use
the `All due`, `Today`, `Overdue`, and `Needed help` local views with title search; matching
rows appear in batches of 20. These controls filter the in-memory snapshot only and never mutate
Notion. Difficulty remains visible on each row, including Hard badges. Setup creates the managed
Notion views with the intended visible columns, filters, sorts,
widths, wrapping, date formatting, frozen title column, disabled subtasks, and hidden vertical grid
lines. `notion:verify` detects presentation drift as well as schema drift; unrelated user-created
views are allowed.

## Quality checks

```bash
npm run check
```

This runs formatting checks, TypeScript, unit tests, the extension production build, a headless
single-worker MV3 suite using the
[official persistent-context extension pattern](https://playwright.dev/docs/chrome-extensions) in
Playwright's bundled Chromium, and the security scan. Install the aligned browser once after
dependencies:

```bash
npx playwright install chromium
```

The MV3 suite uses an isolated Chromium profile and a synthetic Notion REST fixture. Worker
requests are intercepted before they can reach a real service; LeetCode-shaped navigation pages are
fulfilled in memory. No `.env`, real credential, existing browser profile, or live tracker is used.
The legacy dashboard fixture suite remains separate.

## Scope boundaries

The MVP does **not**:

- Read private LeetCode APIs
- Intercept network requests
- Read LeetCode cookies
- Crawl problem lists
- Automatically decide mastery
- Automatically log every submission
- Support arbitrary Notion schemas
- Provide multi-user OAuth
- Include a recruiting CRM

Those are separate features, not prerequisites for solving the personal logging workflow.

## License

MIT — see [`LICENSE`](./LICENSE). Bundled fonts and icons keep their own licenses; see
[`NOTICE.md`](./NOTICE.md).
