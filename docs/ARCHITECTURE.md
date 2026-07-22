# Architecture

## Runtime

```text
deliberate Dock click → visible iTerm2 launcher → local Hono bridge → local daily dashboard

LeetCode problem page
  → read-only content script
  → Chrome side panel
  → POST /api/capture
  → local Hono bridge
  → Notion REST API
  → Problems + Attempts
```

The extension does not call Notion directly. It stores a low-scope bridge token, while the bridge alone stores the Notion integration token.
The owner starts the bridge explicitly from the Dock after login. The launcher remains attached to a
visible iTerm2 session, resolves the repository relative to itself, and never installs a login item or
hidden daemon. An atomic per-repository, per-port claim in the user's temporary directory closes the
pre-bind race between rapid clicks; dead-process claims are reclaimed, while live or malformed claims
fail closed without killing anything.

Dashboard solve counts and due rows come only from Notion. The daily new-solve target is separate,
non-canonical presentation configuration: the bridge atomically stores
`{ "dailyNewProblemGoal": number }` in ignored `build/dashboard-settings.json` and uses
`DAILY_NEW_PROBLEM_GOAL` only when no valid saved preference can be loaded. Serialized saves make the
last accepted request win, and the in-memory denominator changes only after persistence succeeds.

## Provisioning

```text
.env + src/notion/schema.ts
  → npm run notion:setup
  → Notion REST API
  → two databases + relation + three managed table views
  → build/notion-manifest.json (version 3)
```

The setup operation remains intentionally one-time. An existing version-1 tracker uses the single
purpose-built migration path below; this is not a general migration system.

```text
.env + v1 manifest + exact v1/intermediate Notion schema
  → npm run notion:migrate:v2          (dry-run)
  → paginated row inventory + ignored token-free backup
  → npm run notion:migrate:v2 -- --apply
  → atomic build/notion-v2-journal.json before first mutation
  → add v2 fields → backfill → preserve legacy blocks → verify intermediate
  → remove obsolete fields → verify exact v2 → atomic manifest v2 rewrite
```

Shape checks include exact property names and types, including reciprocal relations. No mutation
occurs for unknown or contradictory shapes. Database, data-source, page, relation, and unchanged
property IDs remain in place. Intermediate retries reuse the same v1→v2 path and detect the
durable journal's original values. They enumerate the full page body, complete and verify every
exact `Legacy v1 fields` label, and remove the journal only after the manifest rewrite succeeds.
Journal recovery accepts only the exact migration-owned backfill/expected keys and verifies the
original backup's SHA-256 plus its manifest, shape, count, page-ID, and legacy-value structure before
any recovery mutation.

```text
exact v2 manifest + paginated Problems/Attempts inventory
  → npm run notion:migrate:v3          (dry-run)
  → token-free backup + earliest solved Attempt derivation
  → npm run notion:migrate:v3 -- --apply
  → journal → add/backfill/verify First Solved → manifest v3
```

## Data flow for one capture

1. On startup, the side panel requests the current snapshot. If an extension reload left no receiver,
   it injects the read-only content script once through `scripting` and retries.
2. The content script maps Monaco's rendered fragments to numbered logical lines using public `top`
   positions, normalizes nonbreaking spaces, joins soft wraps, and rejects ambiguous mappings. It
   reports complete code only from line 1 when the public scrollbar shows the whole file; otherwise it
   reports `visible lines X–Y`. A visible non-Monaco textarea is the only fallback.
3. The user confirms one of three outcomes. The extension creates a new UUID `Client Event ID` for
   every deliberate click, including unchanged code.
4. The bridge checks Attempts for that event ID.
5. When already present, the bridge returns the existing attempt and reapplies its stored review state.
6. Otherwise, the bridge finds or creates the Problem by `leetcode:<slug>`.
7. It computes the calendar-date review transition.
8. It creates one immutable Attempt containing Result, Resulting State, Resulting Solved Streak, and
   Resulting Next Review.
9. For a solved Attempt, it sets `First Solved` when missing or later than that Attempt.
10. It updates the Problem's Practice State, Solved Streak, Last Attempt, and Next Review.

The resulting review state is stored on the Attempt so a retry can reconcile a partially completed
write without incrementing the solved streak twice.

Before sending, the extension persists one immutable pending body per tab. An uncertain response
keeps that exact body and Client Event ID as the sole retry action. A successful response replaces it
with a presentation-only `lastSuccess`; outcomes remain enabled, the last result stays selected, and
the bridge's returned review state is rendered until another success or fingerprint change. Version-1
success locks are backward-read for the current Chrome session.

The Notion presentation contract is defined once and shared by setup and verification. It includes
database icons/descriptions, exact native option colors, and three managed table views: Problems
`Review queue` and `All problems`, plus Attempts `Recent attempts`. Verification checks their filters,
sorts, property order and visibility, widths, wrapping, date/time formats, frozen title column,
disabled subtasks, and vertical-grid setting while allowing unrelated user-created views.

## Trust boundaries

### Content script

Can read the currently displayed LeetCode problem page. It cannot access the Notion token or bridge token.

### Side panel

Can access extension storage and call the configured bridge. It creates the capture event only after
explicit submission. Its dashboard shortcut derives the bridge origin’s exact `/dashboard` URL,
focuses a matching tab and Chrome window (preferring an active match), and creates a tab only when no
match exists. It stores no additional shortcut setting. The extension action disables Chrome’s global
side-panel behavior and enables `sidepanel.html` only for the exact tab where the user clicked. The
action is available on any tab, but switching tabs does not carry the panel into tabs where it was not
opened.

### Bridge

Can read and write only the Notion resources exposed by the integration. `/dashboard` is a local,
secret-free HTML surface backed by an in-memory Notion snapshot plus the local goal preference.
`POST /dashboard/settings` accepts only that bounded goal. It requires a per-process token rendered
into the dashboard and repeated in `X-LC-Dashboard-Token`; no CORS headers are enabled for this route.
The file write completes before the in-memory value changes. Extension capture APIs remain bearer
authenticated.

### Notion

Is the canonical store. No second application database is used.
