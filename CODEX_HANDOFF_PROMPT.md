# Codex handoff prompt

You are taking over a deliberately lean, personal LeetCode-to-Notion tracker. Work directly in this
repository and preserve its narrow architecture.

## Product goal

Make this workflow reliable for one user:

1. The user opens an English desktop `leetcode.com/problems/*` page.
2. A Manifest V3 side panel reads public rendered metadata and Monaco code without focusing or
   scrolling the page.
3. The user confirms one outcome: `Couldn’t solve`, `Needed help`, or `Solved`.
4. The authenticated localhost bridge writes one canonical Problem and one immutable Attempt to
   Notion.
5. Every deliberate click is a new Attempt, even for unchanged code. Only an uncertain retry reuses
   the exact serialized body and `Client Event ID`.

## Read and verify first

Read `README.md`, `STATUS.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`,
`docs/NOTION_SCHEMA.md`, `docs/SECURITY.md`, `docs/MANUAL_TEST.md`, the active milestone and its
handoff, then the relevant source and tests. Run:

```bash
npm install
npm run check
```

Do not claim health unless the exact command exits successfully in the current tree.

## Scope and boundaries

Keep exactly two Notion databases, one direct setup/verification path, one localhost Hono bridge,
one MV3 side-panel extension, one explicit schema contract, and manual user-confirmed logging.

Daily runtime startup is also deliberate: `Start LeetCode Tracker.command` runs the existing bridge
in a visible foreground iTerm2 session. Do not replace it with a LaunchAgent, login item, hidden daemon,
cloud bridge, native messaging host, or direct Notion token access unless the user changes scope.

Do not add OAuth, accounts, a hosted database, an ORM, Docker, cloud infrastructure, React, a
monorepo framework, background crawling, private LeetCode APIs, cookies, request interception,
private Monaco APIs/editor-model access, automatic submission logging, coaching, or analytics.
Public rendered-DOM reconstruction is intentional.

## Security and data invariants

1. `NOTION_TOKEN` never enters extension source, storage, logs, build output, examples, or commits.
2. Extension settings contain only bridge URL and bridge token; per-tab capture state lives in
   `chrome.storage.session`.
3. The bridge binds to `127.0.0.1`; capture endpoints remain bearer-authenticated. The public
   `/dashboard` and its narrow `POST /dashboard/settings` use a per-process anti-forgery token and no
   CORS. The settings route changes only the local 1–100 goal.
4. Problem identity is `External Key = leetcode:<slug>`; Attempt identity is a UUID
   `Client Event ID`.
5. Attempts are immutable. A retry reuses the frozen body byte-for-byte and reapplies stored state
   without another Attempt. A new click creates a new body and UUID.
6. An older event may be preserved as an Attempt but must not rewind the canonical Problem.
7. Schema changes update setup, verification, repository mapping, migration, docs, and tests
   together.

## Review schedule

All dates use the browser-local attempt calendar date:

| Result             | Resulting state/streak      | Next review             |
| ------------------ | --------------------------- | ----------------------- |
| Couldn’t solve     | Couldn’t solve / 0          | Same day                |
| Needed help        | Needed help / 0             | +1 day                  |
| Solved, streak 1–4 | Solved / incremented streak | +1, +3, +7, or +14 days |
| Solved, streak 5   | Mastered / 5                | null                    |

Do not substitute another scheduling algorithm.

## One-click extension behavior

- On startup, request a fresh snapshot immediately. If an extension reload left no receiver, inject
  the read-only content script once with `scripting` permission and retry.
- Read visible Monaco view lines and public gutter `top` positions. Join soft-wrapped fragments,
  preserve blank lines and indentation, and convert display-only nonbreaking spaces to spaces.
- Reject ambiguous mappings. An ordinary visible textarea is fallback only when it is not Monaco’s
  input textarea.
- A snapshot is complete only from line 1 when the public scrollbar shows the whole file rendered;
  otherwise label it `visible lines X–Y`.
- Extract title, number, difficulty, topics, and language independently. Never focus or scroll the
  page.
- Layout A has one square-terminal logo with the spaced `LC TRACK` masthead, a compact problem card,
  three equal outcomes, then an expanded code disclosure.
- After success, keep outcomes active, select the last result with `aria-pressed`, and retain its
  confirmation until another success or a fingerprint change.
- During an uncertain write, retry is the sole action and must reuse the stored body exactly.
- Keep **Dashboard ↗** visible in the masthead. Derive it from the Bridge URL, focus an existing exact
  `/dashboard` tab and window when present, and create a tab only when none exists.
- Allow the extension action on any tab, but open LCTrack as a tab-specific side panel only for the
  exact tab where the action was clicked; never enable global action-click side-panel behavior.

## Notion and bridge verification

With the user’s `.env` and existing v2 manifest:

```bash
npm run notion:verify
npm run dev:bridge
```

Verify exactly two databases with reciprocal relations and exact v2 types/options. A capture should
create one Attempt, update the canonical Problem, and return the stored review state. Replaying the
same `Client Event ID` must return `duplicate: true` without another Attempt.

The v1→v2 migration is destructive only after it has paginated every source row and every
potentially paginated legacy property, written a token-free backup and journal, appended and read
back legacy blocks, and verified the intermediate schema. Never weaken those checks.

## Chrome verification

Build and load `dist/extension` unpacked. On a LeetCode problem, open the side panel without touching
the editor. Verify metadata, topics, language, rendered code/range, Layout A, repeat same-fingerprint
clicks with distinct IDs, SPA updates, exact retry retention, authentication errors, and
double-click suppression. The extension never submits automatically.

## Testing discipline

For every behavior change, write a focused failing test, observe the intended failure, implement the
smallest fix, rerun the focused test, then run `npm run check`. Tests changed by the same effort are
development evidence rather than independent acceptance.

## Completion criteria

- `npm run check`, `npm run notion:verify`, `npm run security:scan`, and `git diff --check` pass
  freshly.
- The live Chrome capture and exact-ID replay are confirmed without exposing secrets.
- README, status, architecture, milestone, slice, and handoff records match the implementation.
- All bridge, browser-test, visual-companion, and review-agent processes are stopped.

Report changes, exact verification outcomes, live Notion/Chrome evidence, and remaining limitations.
Do not claim completion from code inspection alone.
