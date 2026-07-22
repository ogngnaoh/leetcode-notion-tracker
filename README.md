# LeetCode → Notion Tracker

A lean personal project that logs LeetCode practice into two Notion databases.

The project deliberately solves one workflow:

1. Open a LeetCode problem.
2. Open the Chrome side panel.
3. Confirm the visible attempt with one of three outcomes.
4. Send the capture to a local bridge.
5. Upsert the canonical problem, append an immutable attempt, and update the next review date in Notion.

## Why this shape

- **Two Notion databases:** one current `Problem` record and many immutable `Attempt` records.
- **Local bridge:** the Notion token never enters the extension.
- **Exact schema:** the extension is for this personal tracker, not every arbitrary Notion database.
- **Manual confirmation:** nothing is sent until you choose `Couldn’t solve`, `Needed help`, or `Solved`.
- **No provisioning framework:** one setup command creates the databases once.

## Repository layout

```text
src/shared/       Capture contract, stable keys, review schedule
src/notion/       One-time setup, migrations, safe dashboard rollback, and exact verification
src/bridge/       Local Hono bridge and Notion repository
extension/        Manifest V3 side-panel extension
scripts/          Extension build script
test/             Unit and bridge route tests
docs/             Architecture, schema, security, and manual QA
```

## Prerequisites

- Node.js 22+
- Chrome 116+
- iTerm2 installed at `/Applications/iTerm.app` for the deliberate daily launcher
- Playwright's bundled Chromium (`npx playwright install chromium`) for `npm run check`
- A Notion workspace
- A Notion internal integration with read, insert, and update content capabilities
- One empty Notion page shared with that integration

## 1. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

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

`notion:setup` creates manifest/schema version 3 directly, including:

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
npm run notion:verify
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
npm run notion:verify
```

Apply journals before mutation and advances the manifest only after verification. Manifest version 3
means the `First Solved` schema; the paid Notion dashboard is retired. Inventory it without mutation
using `npm run notion:dashboard:rollback`, then apply after reviewing the token-free backup with
`npm run notion:dashboard:rollback -- --apply`.

## 3. Configure the one-click bridge launcher

The tracker deliberately does not start a hidden service at login. Configure the visible launcher
once:

1. In Finder, select `Start LeetCode Tracker.command` and open **Get Info**.
2. Under **Open with**, choose **iTerm.app**, then select **Change All**.
3. Drag `Start LeetCode Tracker.command` to the Dock's document area, to the right of the divider.

After each login, click that Dock item once. A titled iTerm2 window starts the local bridge and stays
visible for its entire lifetime. Leave it open while using the extension; press Ctrl-C or close the
window to stop the bridge. A second click opens the dashboard from the already-running bridge without
creating another process. An unexpected port owner is reported and never terminated automatically.

For development, the direct command remains available:

```bash
npm run dev:bridge
```

Notion remains the only source for solve counts and review rows. The daily new-solve target is a
tracker-wide local bridge preference stored atomically in ignored `build/dashboard-settings.json`.
`DAILY_NEW_PROBLEM_GOAL` supplies only the first-run fallback. Use the dashboard masthead’s
**Settings** dialog to choose an integer from 1 through 100; a successful save updates the displayed
target immediately without refreshing Notion.

To review the dashboard’s normal, empty, stale, loading, and unavailable design states locally:

```bash
npm run dev:dashboard:fixtures
```

Open `http://127.0.0.1:8791/dashboard/normal` and replace `normal` with another state name.

Verify it:

```bash
curl http://127.0.0.1:8787/health
```

Expected response:

```json
{ "ok": true, "service": "leetcode-notion-bridge" }
```

## 4. Build and load the Chrome extension

```bash
npm run build:extension
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose `dist/extension`.
5. Open the extension's **Details → Extension options**.
6. Save `http://127.0.0.1:8787` and your `BRIDGE_TOKEN`.
7. Open a page matching `https://leetcode.com/problems/<slug>/`.
8. Select the extension icon to open the side panel.

The side-panel masthead’s **Dashboard ↗** button derives `/dashboard` from the saved Bridge URL. It
focuses an existing exact dashboard tab and its Chrome window when possible, or opens one new tab.
The bottom **Bridge settings** action remains the place to edit the Bridge URL and token.
The extension icon can open LCTrack from any tab, but the panel belongs only to the tab where it was
clicked. Moving to another tab does not carry the side panel with it; click the icon there if you also
want LCTrack on that tab.

## Daily use

1. Click the `Start LeetCode Tracker.command` item in the Dock.
2. The bridge prefetches data and opens `http://127.0.0.1:8787/dashboard`; the side-panel shortcut
   returns to the same dashboard later.
3. Open due problems there and confirm outcomes through the extension side panel.

No Notion credential enters Chrome: the launcher starts the same localhost bridge, which reads the
ignored local `.env` from the repository.

On panel startup, the extension reads from the public problem-page DOM without focusing or scrolling
LeetCode:

- Problem slug
- Problem title and number when visible
- Canonical URL
- Difficulty when visible
- Topic links that are rendered in the DOM, including links below the viewport
- Monaco's rendered logical lines, reconstructed from public line-number and `top` positions
- The nearby visible language control

The code disclosure starts expanded. When Monaco has not rendered the whole file, the panel labels
the exact `visible lines X–Y` range; a normal visible non-Monaco textarea is the only fallback. If an
extension reload left the tab without a content-script receiver, the panel injects the read-only
script once and retries immediately.

Each deliberate outcome click creates a new immutable Attempt and Client Event ID, even when the
code is unchanged. The last successful outcome remains selected until another success or fingerprint
change. Only an uncertain write reuses its frozen body and Client Event ID through `Retry same
attempt`.

Review scheduling is intentionally small:

| Result             | New state / solved streak | Next review      |
| ------------------ | ------------------------- | ---------------- |
| Couldn’t solve     | Couldn’t solve / 0        | Same day         |
| Needed help        | Needed help / 0           | 1 day            |
| Solved, streak 1–4 | Solved / 1–4              | 1, 3, 7, 14 days |
| Solved, streak 5   | Mastered / 5              | None             |

The managed Notion views are `Review queue`, `All problems`, and `Recent attempts`.
The local dashboard shows daily counters and a review table with direct LeetCode URLs. Setup creates them
with the intended visible columns, filters, sorts, widths, wrapping, date formatting, frozen title
column, disabled subtasks, and hidden vertical grid lines. `notion:verify` detects presentation drift
as well as schema drift; unrelated user-created views are allowed.

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

The MV3 suite starts its own authenticated mock bridge and must claim `127.0.0.1:8787`; stop the
visible launcher bridge with Ctrl-C (or stop any other process using that port) before running it. A port collision fails immediately
with an actionable error rather than allowing tests to reach a real bridge. LeetCode-shaped pages
are fulfilled in-memory at matching `https://leetcode.com/problems/<slug>/` navigation URLs; the
suite does not contact LeetCode or Notion.

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

## Handoff to Codex

Open the repository in Codex and paste the complete contents of [`CODEX_HANDOFF_PROMPT.md`](./CODEX_HANDOFF_PROMPT.md).
