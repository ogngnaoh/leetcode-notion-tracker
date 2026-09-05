# Architecture

## Runtime

```text
LeetCode public DOM → metadata-only content publication → Daily Reps (default)
LeetCode editor model → explicit snapshot read → Log → confirmed frozen event
                                                    ↓
Chrome sidebar: Daily Reps / Log / Settings
  → typed packaged-page messages → extension background worker
      ├─ Daily Reps → serialized browser-local repetitions and archives
      ├─ vault → encrypted connection, preferences, one pending event, last completed receipt
      ├─ unlock key and private Review cache → restricted session storage
      └─ shared portable capture/review core → bounded HTTPS Notion transport
                                          → Problems + Attempts
```

No bridge, cloud process, native host, polling alarm, offscreen document, or heartbeat is required.
The production manifest grants Notion and LeetCode hosts only, disables incognito, and restricts
extension network connections to Notion. The legacy bridge and CLI tools remain separate adapters
around the same `src/tracker` core; Node file loading cannot enter the browser bundle.

The worker registers message listeners synchronously and awaits the vault initialization barrier
inside handlers. Notion commands require the extension's own ID and exact packaged sidebar path.
The protocol exposes specific connection, capture, recovery, status, Review, and preference actions;
callers cannot supply HTTP paths or headers. Daily Reps remains independent of Notion configuration.

Chrome may retire the worker. Encrypted local recovery and the session unlock grant are authoritative,
not an in-memory client. Worker hydration sends no requests and never submits a save. Full Chrome
exit, extension reload, update, or disable clears the unlock key. Closing a sidebar does not cancel a
confirmed save; Lock fences it immediately and best-effort aborts any active request.

## Captures and recovery

The worker admits one unresolved capture across the profile. An outcome click freezes the event's
UUID, code, exact timestamp, problem data, and source tab/fingerprint. It encrypts and persists the
whole event with read-back verification before dispatching a mutation. The shared capture service
preserves External Key, Client Event ID, stable latest Attempt IDs, review transitions, exact
receipt timestamps, unrelated notes, and existing Grind compatibility.

A mutation gateway journals non-idempotent page creates and block appends before dispatch. Returned
IDs are validated and persisted. After uncertainty, it requires unique positive evidence of the
original result and reuses that result for the same intent. An empty, conflicting, or incomplete
lookup cannot authorize another create. `Check saved result` uses only this read-only inspector;
it never calls the capture service or the latest-attempt helper that can finish pending receipts.
Explicit Retry resumes the stored event after checking unresolved checkpoints.

Completed Attempt/Problem writes and receipts are followed by one encrypted local transition from
pending to a code-free completion receipt. A lost UI acknowledgement is recovered from that receipt;
reusing its UUID with changed content is rejected. Historical Notion receipts preserve the existing
UUID semantics; they do not provide unlimited historical body-digest verification.

Normal synthetic core request budgets remain 6 for first capture, 10 for replacement, and 5 for a
historical duplicate retry. A retained local completion can answer without a Notion request.
Recovery and pagination add requests as needed. Timing depends on rate pacing, storage, and Notion.

The shared scheduler has one active request, a three-request token bucket refilling at three per
second, and at most two retries for safe reads. Query POSTs are classified separately from mutations.
429/529 cooldown timestamps persist through worker/browser restart and token replacement. Waits over
10 seconds yield control to the user. Actual fetch and body consumption are aborted after 20 seconds;
one operation has a 120-second budget. SDK retries are disabled and logs are sanitized.

## Sidebar

Daily Reps starts each panel opening and uses public metadata only. Full code is requested for
unlocked Log and a confirmed outcome; it is not broadcast to every panel. The versioned extraction
protocol rejects stale script publications and reinjects matching scripts after extension reload.
Monaco and CodeMirror are read without focusing, scrolling, editing, private APIs, or DOM fragments.

The sidebar has two tabs: Daily Reps and Log. Review happens directly in Notion; no sidebar
queue, filters, counters, or review requests remain. The existing worker protocol, encrypted
preferences and cache purging remain compatible with saved vaults. Confirmed captures still
update review state in Notion. Lock continues to purge private session data and fence late results.

Settings contains the only credential form. Chrome options only opens that same sidebar surface.
All private responses carry vault and execution identity; panels also reject responses invalidated
by Lock or source navigation. Recovery is profile-wide even after its original tab closes.

The toolbar icon opens a tab-scoped panel; the unassigned `toggle-side-panel` command opens/closes
it once the user chooses a shortcut. `onOpened`/`onClosed` plus `runtime.getContexts` restore toggle
state after worker retirement. Chrome 142 is required. There is no action popup.

## Trust and operations

Restricted local/session storage excludes content scripts but includes packaged extension pages.
The encrypted vault protects a copied locked profile subject to passphrase strength; while unlocked,
packaged extension code is trusted with the usable credential. See [Security](SECURITY-MODEL.md).

Notion remains canonical for saved attempts and review state. Daily Reps is separate local utility
data. One writer profile is supported: no distributed Notion lock exists. Stop the legacy bridge
before direct use and keep every writer stopped during migration/cleanup. Follow the
[cutover and rollback guide](DIRECT_NOTION_CUTOVER.md); unresolved journal removal cannot prove a
remote write was undone. The [implementation specification](DIRECT_NOTION_SPEC.md) records the
full security, recovery, UI, and performance acceptance criteria.

## Provisioning

```text
.env + src/notion/schema.ts
  → npm run notion:setup
  → Notion REST API
  → two databases + relation + three managed table views
  → build/notion-manifest.json (version 4)
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

```text
exact v3 manifest + paginated Problems/Attempts inventory
  → npm run notion:migrate:v4          (dry-run)
  → token-free backup + earliest Attempt derivation + reclassification plan
  → npm run notion:migrate:v4 -- --apply
  → journal → property rename/backfill → row conversion → option removal
  → exact v4 verification → atomic manifest v4 rewrite
```
