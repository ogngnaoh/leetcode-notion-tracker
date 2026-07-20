# LeetCode → Notion Tracker

A lean personal project that logs LeetCode practice into two Notion databases.

The project deliberately solves one workflow:

1. Open a LeetCode problem.
2. Open the Chrome side panel.
3. Record outcome, help used, time, pattern, and reflection.
4. Send the capture to a local bridge.
5. Upsert the canonical problem, append an immutable attempt, and update the next review date in Notion.

## Why this shape

- **Two Notion databases:** one current `Problem` record and many immutable `Attempt` records.
- **Local bridge:** the Notion token never enters the extension.
- **Exact schema:** the extension is for this personal tracker, not every arbitrary Notion database.
- **Manual confirmation:** LeetCode metadata is prefilled, but you decide Red, Yellow, or Green.
- **No provisioning framework:** one setup command creates the databases once.

## Repository layout

```text
src/shared/       Capture contract, stable keys, review schedule
src/notion/       One-time Notion setup and schema verification
src/bridge/       Local Hono bridge and Notion repository
extension/        Manifest V3 side-panel extension
scripts/          Extension build script
test/             Unit and bridge route tests
docs/             Architecture, schema, security, and manual QA
```

## Prerequisites

- Node.js 22+
- Chrome 114+
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
```

The parent page ID is the ID from the empty Notion page where the two databases should be created.

## 2. Create the tracker in Notion

```bash
npm run notion:setup
npm run notion:verify
```

`notion:setup` creates:

- `LeetCode Problems`
- `LeetCode Attempts`
- A two-way relation between them
- `build/notion-manifest.json` containing non-secret database and data-source IDs

The command refuses to run when the manifest already exists, preventing accidental duplicate databases.

## 3. Start the local bridge

```bash
npm run dev:bridge
```

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
6. Save `http://127.0.0.1:8787`, your `BRIDGE_TOKEN`, and your default language.
7. Open a page matching `https://leetcode.com/problems/<slug>/`.
8. Select the extension icon to open the side panel.

## Daily use

The extension detects:

- Problem slug
- Problem title and number when visible
- Canonical URL
- Difficulty when visible

You record:

- Red, Yellow, or Green
- Submission result
- Language
- Minutes
- Help used
- Failure code
- Primary pattern
- Reflection
- Optional code snapshot

Review scheduling is intentionally small:

| Result       | New state                 | Next review |
| ------------ | ------------------------- | ----------- |
| Red          | Red, Green Count reset    | 1 day       |
| Yellow       | Yellow, Green Count reset | 2 days      |
| First Green  | Green                     | 3 days      |
| Second Green | Green                     | 7 days      |
| Third Green  | Mastered                  | None        |

## Quality checks

```bash
npm run check
```

This runs formatting checks, TypeScript, unit tests, and the extension production build.

## Scope boundaries

The MVP does **not**:

- Read private LeetCode APIs
- Intercept network requests
- Read LeetCode cookies
- Crawl problem lists
- Automatically decide mastery
- Automatically log every submission
- Capture Monaco editor contents
- Support arbitrary Notion schemas
- Provide multi-user OAuth
- Include a recruiting CRM

Those are separate features, not prerequisites for solving the personal logging workflow.

## Handoff to Codex

Open the repository in Codex and paste the complete contents of [`CODEX_HANDOFF_PROMPT.md`](./CODEX_HANDOFF_PROMPT.md).
