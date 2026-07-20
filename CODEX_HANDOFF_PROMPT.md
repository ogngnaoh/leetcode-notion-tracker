# Codex handoff prompt

You are taking over a deliberately lean, personal LeetCode-to-Notion tracker.

Work directly in this repository. Do not replace it with a larger architecture.

## Product goal

Make this workflow reliable for one user:

1. The user opens one LeetCode problem in Chrome.
2. A Manifest V3 side panel detects the current problem's visible metadata.
3. The user records outcome, help used, time, pattern, reflection, and optional code.
4. The extension sends one validated capture to a narrow personal bridge.
5. The bridge writes through the direct Notion REST API.
6. Notion contains one canonical Problem row and one immutable Attempt row.
7. Repeating the same `Client Event ID` never creates another Attempt.
8. The Problem receives the correct mastery, Green Count, Last Attempt, and Next Review.

## Read first

Read these files in order before modifying anything:

1. `README.md`
2. `STATUS.md`
3. `AGENTS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/NOTION_SCHEMA.md`
6. `docs/SECURITY.md`
7. `docs/MANUAL_TEST.md`
8. All source and test files

Then run:

```bash
npm install
npm run check
```

Do not claim the project is healthy unless that exact command exits successfully in your current working tree.

## Scope

This is a private, single-user project. Keep the MVP to:

- Two Notion databases: `LeetCode Problems` and `LeetCode Attempts`
- One direct Notion setup script
- One schema verification script
- One localhost Hono bridge
- One Chrome MV3 side-panel extension
- One explicit schema contract
- Manual, user-confirmed logging

## Do not add

Unless the user explicitly changes scope, do not add:

- A recruiting CRM
- Notion MCP
- A generalized schema mapper
- Multiple tracker templates
- Notion OAuth
- User accounts
- A hosted database
- An ORM
- Docker
- Kubernetes
- React, Next.js, or a UI component framework
- Turborepo, Nx, or another monorepo framework
- Background LeetCode crawling
- Private LeetCode APIs
- Cookie access
- Network interception
- Automatic logging of every run or submission
- Automatic Monaco editor extraction
- AI-generated coaching
- Analytics dashboards
- Cloud deployment infrastructure

Prefer deleting unnecessary complexity over preserving it.

## Security invariants

These are non-negotiable:

1. `NOTION_TOKEN` must never appear in extension source, Chrome storage, logs, build output, examples, or committed files.
2. The extension may store only the bridge URL, bridge token, and user preferences.
3. The bridge must expose no generic Notion proxy endpoint.
4. The bridge must bind to `127.0.0.1` by default.
5. Capture writes require `Authorization: Bearer <BRIDGE_TOKEN>`.
6. The content script reads only the active `leetcode.com/problems/*` page.
7. No data is sent until the user presses `Log attempt`.
8. Never print request authorization headers or the Notion token.

## Data invariants

1. Problem identity is `External Key = leetcode:<slug>`.
2. Attempt identity is `Client Event ID = UUID`.
3. Attempts are immutable historical records.
4. A Problem may have many Attempts.
5. The resulting review state is stored on the Attempt before it is applied to the Problem.
6. Retrying an existing event must reapply the stored state rather than incrementing mastery again.
7. The Notion schema names and types in `docs/NOTION_SCHEMA.md` are the contract.
8. Any schema change must update setup, verification, repository mapping, documentation, and tests in the same change.

## Review behavior

Preserve this exact MVP schedule:

| Outcome              | Green Count | Mastery  | Next review           |
| -------------------- | ----------: | -------- | --------------------- |
| Red                  |           0 | Red      | Attempt time + 1 day  |
| Yellow               |           0 | Yellow   | Attempt time + 2 days |
| First Green          |           1 | Green    | Attempt time + 3 days |
| Second Green         |           2 | Green    | Attempt time + 7 days |
| Third or later Green |          3+ | Mastered | null                  |

Do not silently replace this with SM-2 or another algorithm.

## Current implementation

The repository already contains:

- Zod capture and manifest contracts
- Stable key generation
- Review logic
- Idempotent capture service
- In-memory repository and tests
- Hono routes and bearer-token middleware
- Direct Notion repository
- Direct Notion setup and verification scripts
- MV3 manifest, background service worker, content script, side panel, and options page
- Extension build script
- Unit and route tests

Treat existing code as a working scaffold, not as throwaway pseudocode.

## Your first objective: verify the live Notion setup

The current environment cannot provide the user's Notion credentials. With the user's `.env` configured, complete this sequence:

```bash
npm run notion:setup
npm run notion:verify
```

Inspect the real workspace and verify:

- Exactly one `LeetCode Problems` database was created.
- Exactly one `LeetCode Attempts` database was created.
- Each database has one primary data source.
- Every required property exists with the expected type.
- `LeetCode Attempts.Problem` points to `LeetCode Problems`.
- The reciprocal relation is named `Attempts`.
- `build/notion-manifest.json` contains the correct database and data-source IDs.
- The manifest contains no secrets.

If an API request fails, do not guess. Capture the exact HTTP/API error, compare the request with the current official Notion API documentation for version `2026-03-11`, write a focused failing test or fixture where practical, and make the smallest fix.

Do not make setup rerunnable by creating a migration framework. The intended behavior is to refuse when the manifest already exists.

## Your second objective: verify bridge writes

Start the bridge:

```bash
npm run dev:bridge
```

Then execute:

```bash
export BRIDGE_TOKEN='<the value from .env>'
./examples/curl-capture.sh
./examples/curl-capture.sh
```

Verify in Notion:

- One Problem exists for `leetcode:two-sum`.
- One Attempt exists for the example UUID.
- The second request returns `duplicate: true`.
- The second request creates no new Attempt.
- The Problem is Green with Green Count 1.
- Last Attempt and Next Review are correct.
- Reflection and optional code appear in the Attempt page body.

If the first capture succeeds but the Problem update fails, retry the same event and verify the stored resulting state repairs the Problem without creating a duplicate.

## Your third objective: verify the extension in Chrome

Build:

```bash
npm run build:extension
```

Load `dist/extension` as an unpacked extension in Chrome.

Configure:

- Bridge URL: `http://127.0.0.1:8787`
- Bridge token: the value from `.env`
- Default language: the user's preferred interview language

Test on at least:

- `https://leetcode.com/problems/two-sum/`
- One medium problem
- One problem after client-side navigation without closing the LeetCode tab

Verify:

- The action opens the side panel.
- Title, slug, number, canonical URL, and difficulty are populated when visible.
- A non-LeetCode tab is rejected clearly.
- A missing bridge token produces a useful message.
- A stopped bridge produces a useful message.
- A valid form creates the expected Notion entries.
- The form never submits automatically.

LeetCode's DOM changes. When a selector fails:

1. Inspect only the currently open problem page.
2. Identify the smallest stable visible selector or fallback.
3. Add an extraction fixture or focused test before changing the extractor when feasible.
4. Preserve the URL- and `document.title`-based fallbacks.
5. Do not introduce private API calls, request interception, cookies, or bulk scraping.

## Testing discipline

For every behavior change:

1. Add or modify one focused test.
2. Run it and confirm it fails for the intended reason.
3. Implement the smallest behavior.
4. Run the focused test.
5. Run `npm run check`.

Do not write tests after implementation merely to increase coverage.

## Error handling expectations

User-facing errors must explain the next action without exposing secrets.

Examples:

- `Open Bridge settings and save your bridge token first.`
- `The active tab is not a LeetCode problem.`
- `Could not read the current problem. Refresh the LeetCode tab.`
- `Notion tracker schema mismatch. Run npm run notion:verify.`

Bridge logs may include event IDs, problem slugs, response status codes, and sanitized Notion error messages. They must not include tokens or authorization headers.

## Keep the extension lean

The current side-panel form is the product. Improve accessibility and clarity only when a real test or manual-use problem warrants it.

Do not add an offline queue for the first release. A failed capture stays in the form so the user can retry. Add durable queuing only after the user actually experiences lost captures.

Do not add automatic accepted-result detection for the first release. Outcome cannot be inferred from an Accepted result because help usage and reasoning quality still require the user.

## Completion criteria

The personal MVP is complete only when all of the following are true:

- `npm run check` exits zero.
- `npm run notion:verify` passes against the real workspace.
- The sample capture writes one Problem and one Attempt.
- Replaying the sample creates no duplicate.
- One live Chrome capture succeeds on LeetCode.
- The Notion token is absent from extension source and output.
- The README matches the actual setup procedure.
- `STATUS.md` accurately distinguishes verified behavior from deferred features.

## Final response format

When reporting back, provide:

1. A short description of what changed.
2. Exact commands run and their outcomes.
3. Live Notion test evidence without secrets.
4. Chrome manual-test results.
5. Any known limitations that remain.
6. The next single feature worth considering, if any.

Do not claim completion based only on code inspection. Provide fresh command output and real end-to-end evidence.
