# Direct Notion overhaul: implementation plan

> Historical implementation record. For current operation, use the [documentation index](README.md).
> Review-tab designs and acceptance evidence describe the earlier release; the current sidebar
> has Daily Reps and Log, with review in Notion. Security and recovery details remain relevant.

Status: implemented; final release validation recorded in the companion implementation status.
Prepared 2026-09-03 and completed 2026-09-04.

Read the [implementation specification](DIRECT_NOTION_SPEC.md) first. It defines the behavior;
this document defines ownership, order, evidence, and handoff. The user requested agent discussion
and a plan/spec before implementation. The plan is retained as the decision and execution record.

## Decisions from the agent discussion

The coordinating agent reviewed the repository while three agents independently examined security,
runtime implementation, and the approved sidebar. They exchanged findings, reconciled the following
decisions, and used them to guide the implementation.

| Question                         | Alternatives considered                                         | Decision and reason                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyday connection              | Native helper, hosted endpoint, direct Notion                   | Direct worker calls best fit the user's preference for no service to start or host. Retain scoped credential protection in Chrome.                                |
| Persistent credential            | Plaintext token, session-only token entry, encrypted vault      | Encrypt locally with a user passphrase; unlock once per browser session. Session-only entry repeats token handling, and plaintext persistence weakens protection. |
| Unlock state                     | Worker globals, session data key, keepalive                     | Session key survives normal worker retirement. Explicitly acknowledge all trusted extension contexts can access it. No keepalive.                                 |
| Password changes                 | Reencrypt all data, rewrap random data key                      | Rewrap so a pending attempt remains decryptable; serialize maintenance and verify the persisted result.                                                           |
| Pending work                     | Per-tab session memory, durable queue, one durable event        | One encrypted unresolved event per profile. Enough for restart recovery with a small state machine. Other captures wait; Daily Reps remains usable.               |
| Lock during save                 | Wait for save, abort and fence immediately                      | Immediate fence/abort/purge; preserve uncertainty after dispatch. Never claim abort rolled back Notion.                                                           |
| Ambiguous first create or append | Repeat request, trust an empty query, verified checkpoint reuse | Persist intent before dispatch and require positive read-only recovery. Empty/ambiguous results stay blocked rather than create duplicates.                       |
| Locked Review                    | Keep private stale rows, hide private data                      | Purge rows/counts/code on Lock. Stale cached Review is available only while unlocked.                                                                             |
| Multiple profiles/devices        | Notion lease, cloud coordinator, operational single writer      | One supported writer profile. No reliable distributed lock is available in this design; state the limit and stop old writers at cutover.                          |
| Existing sidebar                 | New framework, iframe dashboard, existing HTML/CSS modules      | Extend the accepted design using the existing stack and share pure review logic.                                                                                  |
| Input/journal bounds             | Agents suggested 64 KiB/256 KiB; larger bounded envelope        | Use 128 KiB UTF-8 event and 1 MiB root caps to accommodate 20,000-character Unicode code plus recovery checkpoints; test worst cases and quota failure.           |

The runtime review found a concrete risk in current code: Problem lookup selects the first match,
and an absent indexed result can trigger another create after a lost response. Managed block
appends also need intent tracking. This is a required reliability fix within the overhaul, not a
promise that the current External Key field provides a uniqueness constraint.

The frontend review identified another necessary change: current context publication can carry code
even while Daily Reps is active. The new protocol publishes metadata/invalidation and requests code
only for unlocked Log/capture, preventing late broadcasts from refilling locked views.

The agents' second review of the written draft required—and this revision incorporates—persistent
revocation after a failed Lock, a separate genuinely read-only Check path, durable completed-result
acknowledgement, positive reconciliation before rollback/reset can enable writes, resolved-checkpoint
identity rules, exact scheduler defaults, panel-side stale-response rejection, and a sidebar-only
credential form. The extraction protocol bump and stale-script regression gate are also explicit.

## Current state to preserve

- The pre-overhaul product version was `0.2.15`; the implemented release is `0.3.0`. Chrome minimum remains 142.
- The previous full repository check passed 499 unit tests (one skipped), 36 browser tests,
  formatting, type checking, and secret scanning during the benchmark task. That is baseline evidence,
  and was not validation of the then-unimplemented design.
- Existing native benchmark: 54 synthetic timing trials; see
  [the historical report](NATIVE_HELPER_BENCHMARK.md). The completed direct-mode measurement is in
  [the direct benchmark report](DIRECT_NOTION_BENCHMARK.md).
- Approved visual: [sidebar-approved.png](design/sidebar-approved.png). Security/runtime changes
  do not reopen the accepted cream/black/pink/cobalt visual direction.
- Preserve the dirty checkout's work in `docs/ARCHITECTURE.md`, `docs/NOTION_SCHEMA.md`, version files,
  `src/bridge/capture-service.ts`, `latest-attempt.ts`, `notion-repository.ts`, `notion-timestamps.ts`,
  and the related existing tests. Preserve benchmark scripts/tests and planning/design artifacts.
- Read existing files before moving/refactoring; do not reset, overwrite, or assume those edits
  are disposable. Do not read/copy `.env` as part of planning or automated tests.

## Proposed module ownership

The implementation follows these ownership boundaries; a few filenames were consolidated where one
module could keep the interface smaller.

| Area                       | Files and responsibility                                                                                                                                          | Builder owner                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Portable domain/repository | Move capture service, repository interface/implementation, latest-attempt, timestamp helpers into `src/tracker/`; preserve one algorithm shared with legacy tools | Runtime builder                    |
| Node adapter               | `src/bridge/notion-repository-node.ts` owns file manifest loading and legacy factory; update callers without changing legacy semantics                            | Runtime builder                    |
| Review model               | `src/tracker/review.ts` contains snapshot/date/store logic; extract required pure filters/preferences from bridge assets/filesystem code                          | Runtime builder, then UI builder   |
| Vault                      | `extension/src/notion-vault.ts` owns versioned crypto, aggregate storage serialization, key session state, lock/rekey/reset behavior                              | Security builder                   |
| Protocol/runtime           | `notion-protocol.ts`, `notion-runtime.ts`, `background.ts` own typed dispatch, caller checks, operation admission/generation, and coordination                    | Runtime builder                    |
| Transport/recovery         | `notion-transport.ts`, `pending-capture.ts`, `notion-recovery.ts` own bounded SDK fetch, rate handling, encrypted checkpoints, and positive recovery              | Runtime builder                    |
| Connection/preferences     | `notion-connection.ts`, `review-preferences.ts` own strict import, read-only validation, immutable tracker binding, and local goal/session settings               | Security/runtime integration owner |
| Sidebar                    | `sidepanel.ts` becomes shell composition with Daily/Log/Review/Settings modules; `api.ts` becomes a narrow worker-message client                                  | UI builder                         |
| Extraction/tab behavior    | Context protocol, `content.ts`, snapshot reader/coordinator, and controller preserve exact source-tab capture and implement metadata-only publication             | UI builder with runtime review     |
| Packaging/docs             | Manifest/CSP, browser build target, thin options entry, current documentation, test fixtures, release versions and rollback notes                                 | Coordinating integrator            |

Do not duplicate capture algorithms or maintain two credential Settings implementations. Do not
import CLI modules with environment/file side effects into the worker. The SDK's Node-centric
packaging requires real-browser proof; its successful no-output bundle check is not sufficient.

## Milestones and dependency order

### M1 — Portable core and browser feasibility

1. Capture a fresh baseline/diff and preserve the existing changes. Write failing tests for the
   changed boundaries before behavior edits.
2. Separate Node manifest loading from the browser-safe capture/repository core. Existing bridge
   and CLI adapters keep using that same core during development.
3. Define the strict operation protocol, immutable tracker binding, vault/journal schemas, transport
   operation classification, and storage interfaces before parallel builders diverge.
4. Prove the installed SDK works from actual MV3 worker fetch against the isolated synthetic Notion
   fixture. Check headers, response consumption, aborts, bundle contents, and pinned API version.

Exit evidence: existing core tests pass; browser fixture succeeds; no Node-only/credential-bearing
module enters extension output; module/protocol contracts are settled. If SDK runtime compatibility
fails, first adapt its injected fetch; consider a small typed endpoint adapter only on a demonstrated
blocker, not an upfront repository rewrite.

### M2 — Vault, session lifecycle, and connection setup

Implement Web Crypto, strict encrypted envelope parsing, awaited storage access restriction,
serialized commits/read-back, session unlock, persistent grant revocation, generation fencing,
the manual-reconciliation safety flag, and read-only connection/import.
Implement Lock, passphrase rewrap, same-target token replacement, and explicit reset semantics.
Provide synthetic state fixtures to UI work; no real credential migration.

Exit evidence: wrong passphrase/tamper/oversize failure preserves vault; session unlock survives
worker retirement and is lost on browser restart; Lock cannot be undone by late async completion;
storage failure prevents new mutation; existing Daily Reps survives every vault operation.

### M3 — One capture and reliable recovery

Implement the global write gate, encrypted immutable pending event, bounded scheduler/transport,
typed non-idempotent write checkpoints, safe read-only recovery, completed-result acknowledgement,
and manual retry. Keep normal 6/10/5 request counts. Any extra request must be justified by recovery,
pagination, or an explicit correctness decision and reflected in the tests/report.

Exercise interruption before/after every remote mutation and local checkpoint commit. A positive
recovery match is reused by the gateway; an empty or conflicting result never causes blind create.
Test known canonical Attempt relations in the presence of Grind-only duplicates. Distinguish
an individual rejected request from a capture that already performed earlier writes.

Exit evidence: unchanged normal results/page IDs, exact retry payload across restart/tab closure,
no automatic writes on startup/unlock, two-panel admission safety, lock/timeout/429/529 recovery,
and actionable fail-closed states for genuinely ambiguous remote outcomes.

### M4 — Integrated sidebar and migration UX

Build the three-tab shell and shared Settings using the accepted concept and the complete state
inventory in the spec. Preserve Daily Reps behavior. Replace bridge calls with typed messages;
move pending authority out of per-tab session records. Implement metadata-only publication and
unlocked full-model reads. Port the Review summary/filter/list without its server-rendered HTML.

UI structure/state work can run alongside M2/M3 after M1 contracts exist. Runtime owns shared
protocol/background files; UI owns render/controller files. Sequence overlapping changes through
the integrator. Security review stays non-editing while a builder owns the vault.

Exit evidence: fixture-driven state coverage, widths/heights/text zoom, keyboard/status/focus checks,
locked-data purge in all panels, tab-affinity regressions, correct preferences import/reset, and
source-image/render comparison with a written fidelity ledger. Sample image data never becomes
production defaults. Use the browser skill's verification workflow; retain isolated Playwright
for extension-only lifecycle/failure tests where those controls are required.
Explicitly test the extraction protocol upgrade/reinjection, and ensure Chrome's options page
only opens the sidebar Settings through a user gesture and never contains credential fields.

### M5 — Direct-mode measurement, release preparation, and cutover

Extend the existing synthetic benchmark fixture to direct MV3 execution. Measure password unlock
separately from steady-state saves; include worker cold start, first/replacement/retry latency,
browser CPU, extension bundle size, worker retirement, and zero idle Notion requests. Separate
intentional rate pacing and storage durability work from transport overhead. Do not infer a direct
memory saving from the native-host measurements or attribute the whole browser's RSS to LCTrack.

Validate realistic data/receipt pagination, a 20,000-character Unicode solution, and bounded storage.
Use nine interleaved samples for timing comparisons where useful; report medians and largest
observations honestly. Verify idle behavior in ordinary Chrome without an attached debugger as
well as controlled termination tests. Never reduce password strength merely to improve a timing.

Prepare the same-path release, strict production manifest/CSP, migration instructions, backup/rollback
instructions, and updated current docs. Run the complete repository gate and fresh non-editing review.
Propose a minor release (`0.3.0` if the current version remains `0.2.15`) because connection/storage
behavior changes materially; synchronize package.json, root lock entry, and manifest only when shipping.

Cutover occurs after the implementation is reviewable and the user requests it: resolve old pending
saves before extension reload, stop legacy writers, import metadata/preferences, connect explicitly,
and retain the rollback release. A live test capture requires the user's deliberate outcome or
specific authorization; use no dummy production writes during Connect. Do not deploy, publish,
rotate/revoke credentials, or uninstall old tools merely because code is ready.

## Acceptance matrix

| ID     | Scenario and required evidence                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-1  | Persistent vault, diagnostics, source, bundles, logs and session records contain no plaintext token/passphrase/pending code; unwrapped key exists only in permitted session/runtime memory             |
| SEC-2  | Content scripts/external pages cannot read sensitive storage or invoke vault/Notion operations; spoofed page URLs, protocol versions and oversized inputs fail closed                                  |
| SEC-3  | Modified ciphertext/AAD/tracker binding, wrong password, excessive KDF parameters and unknown formats preserve existing state and issue zero mutations                                                 |
| SEC-4  | Lock racing connect/unlock/rekey/fetch clears private views and fences requests; failed key removal plus worker restart cannot revive a revoked grant; double storage failure reports Lock failed      |
| SEC-5  | Password rewrap/token replacement preserve pending binding; an interrupted update leaves recoverable valid state; reset/disconnect preserves Daily Reps and never implies remote revocation            |
| SAVE-1 | Existing first/replacement/duplicate fixtures remain 6/10/5, with correct review state, exact timestamp behavior, stable Attempt ID, notes and receipt retention                                       |
| SAVE-2 | Locally retained UUID/different body is rejected; rapid double-click and concurrent panels cannot admit a second event; closing/navigating tabs cannot mutate the pending snapshot                     |
| SAVE-3 | Crash/abort/lost response at each Problem create, Attempt create, container/receipt append, code/page update and receipt completion boundary preserves recovery                                        |
| SAVE-4 | Positive unique discovery reuses the target; resolved targets accept legitimate later updates; negative/stale/duplicate/partial discovery sends no duplicate create/append; Check sends zero mutations |
| SAVE-5 | Restart preserves encrypted pending, requires unlock, and performs no write until explicit Retry; completion-ack loss never turns into a new UUID                                                      |
| SAVE-6 | Quota failure, local commit uncertainty, 401/403 after earlier writes, 429/529 cooldown, network/body timeout and malformed success retain correct whole-capture disposition                           |
| READ-1 | Complete pagination, date/session boundary, optional Grind compatibility, four filters+search, display batches, stale/error/empty states and generation-fenced preferences                             |
| UI-1   | Daily/Log/Review/Settings and confirmations at 320/360/400/480 widths, short heights and text zoom; no page overflow, clipping or shrunken unreadable controls                                         |
| UI-2   | Approved shell/palette/typography/icons/preview/outcomes/summary/rows compared to rendered screenshots; intentional copy changes listed                                                                |
| UI-3   | Keyboard tabs/dialogs, focus restoration, announcements, text+color state indicators, safe links and source-tab preservation                                                                           |
| UI-4   | Metadata-only publication does not expose code to locked private views; late extraction/status/cache results cannot refill cleared data                                                                |
| MIG-1  | Exact v4 manifest and old preference imports; invalid/extra/token-bearing fields leave state unchanged; explicit handling of missing preferences                                                       |
| MIG-2  | Zero pending legacy saves before reload; same extension identity preserves Daily Reps/shortcuts; rollback never enables simultaneous legacy/direct writers                                             |
| PERF-1 | Measured unlock/cold/warm costs, bundle growth, idle request count and worker retirement; no unsupported battery or direct-mode performance claim                                                      |
| GATE-1 | `npm run check`, secret scan, changed-file review, and all required synthetic browser/security/recovery tests pass before completion is claimed                                                        |

Tests should verify boundary behavior and failure outcomes, not mirror implementation details.
Real tokens never enter fixtures, traces, screenshots, test reports, or benchmark output.

## Completed verification and handoff

Actual SDK worker execution, crash-safe journal/gateway behavior, read-only schema checks, session-key
purge races, full-browser restart, ordinary idle behavior, and visual fidelity are now covered by the
implementation evidence. Unresolvable remote ambiguity remains an explicit product state.

The accepted scope is personal/single-profile. A request for multiple simultaneous writer profiles,
automatic Notion provisioning, permanent auto-unlock, cloud sync, or lost-passphrase recovery is a
new design decision rather than an implicit addition to this overhaul.

For installation and user-owned connection steps, follow the
[cutover guide](DIRECT_NOTION_CUTOVER.md). Automated validation never reads a real credential or
writes to a live Notion workspace.

### Historical planning handoff verification

All three agents re-read the revised fixes and reported no remaining blocking finding within their
review scope. This is a design review, not a security certification or a test of future behavior.
Local document links and formatting pass. Hashes of every already-modified tracked file match the
start-of-planning snapshot, preserving the user's existing work. A fresh `npm run check` passed:
499 unit tests (one skipped), 36 browser tests, type checking, formatting, and secret scanning.
Only the two new planning documents and the supersession notice in the prior native plan changed
during that planning task. The later user-authorized implementation and its evidence are recorded
in the [implementation status](DIRECT_NOTION_IMPLEMENTATION_STATUS.md).
