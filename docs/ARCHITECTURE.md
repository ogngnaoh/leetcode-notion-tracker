# Architecture

## Runtime

```text
deliberate Dock click → visible iTerm2 launcher → local Hono bridge

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

## Provisioning

```text
.env + src/notion/schema.ts
  → npm run notion:setup
  → Notion REST API
  → two databases + relation
  → build/notion-manifest.json (version 2)
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
9. It updates the Problem's Practice State, Solved Streak, Last Attempt, and Next Review.

The resulting review state is stored on the Attempt so a retry can reconcile a partially completed
write without incrementing the solved streak twice.

Before sending, the extension persists one immutable pending body per tab. An uncertain response
keeps that exact body and Client Event ID as the sole retry action. A successful response replaces it
with a presentation-only `lastSuccess`; outcomes remain enabled, the last result stays selected, and
the bridge's returned review state is rendered until another success or fingerprint change. Version-1
success locks are backward-read for the current Chrome session.

The optional `Due now` view is a one-time UI concern: filter `Next Review on or before Today` and sort
ascending. Public Notion API view management is unsupported, so automated setup and migration do not
create or claim this view.

## Trust boundaries

### Content script

Can read the currently displayed LeetCode problem page. It cannot access the Notion token or bridge token.

### Side panel

Can access extension storage and call the configured bridge. It creates the capture event only after explicit submission.

### Bridge

Can read and write only the Notion resources exposed by the integration. Its public surface is intentionally limited to `/health`, authenticated read-only `/api/problems/:slug/status`, and authenticated `/api/capture`.

### Notion

Is the canonical store. No second application database is used.
