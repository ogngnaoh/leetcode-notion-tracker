# Security and privacy

## Direct connection boundary

The extension stores a dedicated Notion internal-integration token only in an encrypted local vault.
The approved direct-connection overhaul replaces the old token-never-in-extension boundary; the
session exception and limits are documented in [the specification](DIRECT_NOTION_SPEC.md).
No token, passphrase, or unwrapped key belongs in source, builds, logs, diagnostics, sync storage,
or persistent plaintext records. Enter credentials only in sidebar Settings. Chrome options is a
credential-free launcher; no OAuth, hosting account, remote key service, or native helper is used.

Awaited `TRUSTED_CONTEXTS` access restrictions protect both local and session storage from content
scripts. They include packaged extension pages and do not imply worker-only secrecy. Only the
extension's own exact sidebar URL can issue the versioned narrow Notion commands. Incognito is
unsupported and disabled by the manifest. Production requests use fixed Notion HTTPS endpoints,
omit ambient credentials, reject redirects, and pass no caller-selected URL/header through a proxy.

## Vault and unlock

A random 256-bit data key encrypts the connection and recovery data using AES-256-GCM, fresh 12-byte
IVs, and a 128-bit tag. PBKDF2-HMAC-SHA-256 with 600,000 iterations and a random 16-byte salt derives
the wrapping key from the user's passphrase. Password changes rewrap the same data key with fresh
salt and IV. Authenticated metadata binds record purpose/version, vault identity, immutable tracker
IDs, and the pending event. Removing/swapping recovery ciphertext fails authentication.

The passphrase is not saved. Inputs require at least 16 Unicode characters and no more than 1,024
UTF-8 bytes; tokens are bounded to 4 KiB. Confirmed events are at most 128 KiB UTF-8 with the existing
20,000-character code limit, and the encrypted aggregate is at most 1 MiB. Unsupported formats,
excessive derivation parameters, unexpected fields, and invalid encodings fail before expensive work.
Wrong passwords or corrupted data never overwrite a valid saved connection with defaults.

Session storage contains the unwrapped data-key bytes, vault binding, and a random grant identity.
These bytes are credential-equivalent. They survive worker retirement but disappear after full
Chrome exit, extension reload, update, or disable. The plaintext token is never saved to session
storage. Private Review snapshots may be cached there while unlocked; pending code stays encrypted
in local storage. The browser may remain running after its last window closes.

**Lock now** immediately fences dispatch, best-effort aborts active requests, revokes the grant, and
purges authority/private caches. Cache writes are serialized ahead of purge and removal is checked
before success. Epoch and private-view revisions reject late results and hydration. If key removal
fails, durable grant revocation prevents a restarted worker from accepting the old key. If both
revocation and key removal fail, durable locking cannot be guaranteed; the UI reports Lock failed
and requires retry or full Chrome exit. It never presents that condition as a successful lock.

No vault scheme can protect against malicious packaged extension code, a compromised browser/OS,
or memory inspection while unlocked. JavaScript cannot guarantee physical memory erasure. Offline
password guessing resistance depends on passphrase strength. Changing the passphrase cannot secure
old vault copies; revoke a compromised token separately in Notion. There is no passphrase recovery,
token reveal/export button, automatic clipboard copy, or permanent auto-unlock.

## Least access and recovery

Use a dedicated internal integration with read/insert/update capabilities and sharing restricted to
Problems/Attempts and their contents. Parent sharing includes children. Read-only Connect verifies
the v4 schema, two database/data-source bindings, and reciprocal relations; it cannot prove write
capability or detect all unrelated sharing. It creates no dummy pages and imports no `.env` file.

One encrypted pending save is durable before mutation. A lost response or abort can mean Notion
already accepted the write. Check performs read-only positive reconciliation; negative discovery
does not justify another create/append. Explicit retry preserves the exact original event and
validated targets. The most recent code-free completed receipt survives a lost panel reply.

Disconnect/reset removes only Notion local state and preserves Daily Reps and remote pages. If
pending recovery exists or cannot be inspected, a warning and explicit confirmation are required.
A nonsecret reconciliation-required flag must persist before recovery is deleted; otherwise deletion
fails. A newly configured connection cannot capture until the user confirms manual reconciliation.
Token replacement is validated against the same tracker binding and does not retry pending work.

## Daily Reps and legacy tools

Daily Reps stores public metadata, timestamps, goals, and manually archived sessions under its own
versioned local key. It contains no code, outcomes, Notion IDs, or credentials and is not cloud synced.
Vault operations never globally clear extension storage. Uninstalling or clearing extension storage
removes browser-local data. Legacy bridge settings, if present from an older release, are unused.

One-time setup and legacy maintenance commands still read the ignored local `.env`. They do not
transfer it to Chrome. Migration backups/journals exclude tokens, headers, clients, and environment
variables, but can contain personal page data or code and must remain under ignored local `build/`.
The optional legacy bridge binds to loopback and keeps its narrow API; the direct extension has no
localhost permission. Never run legacy and direct writers together. See
[legacy tools](LEGACY_BRIDGE.md) and [cutover](DIRECT_NOTION_CUTOVER.md).

## LeetCode access

The extension reads only the active `leetcode.com/problems/*` page. Problem title, difficulty, and
topics come from the public DOM through the declared read-only content script. An inactive mounted
Description pane may supply metadata only
when its title link matches the current URL's slug, including on an accepted-submission route. Reading
this pane does not click, focus, or activate it, and never requests another page. Captured code comes
from the active Monaco or CodeMirror state model, read by a second declared content script running in
the page's own JavaScript world. Monaco supplies its model language id; focus mode supplies the
language from the CodeMirror content element scoped beneath LeetCode's problem-editor marker. The
bridge answers nonce- and protocol-matched requests over `window.postMessage`, and the side panel
reinjects both scripts once after an extension reload when the receiver is missing or stale. Neither
script focuses, scrolls, edits, or reconstructs code from the virtualized editor DOM.

Because the model reader runs in the page's world, a hostile page could forge a reply and supply code
the user did not write. This is not a new exposure: the page already controls every element the
extension reads. Replies are validated for shape and matched against a per-request nonce, and a
missing reply blocks capture rather than substituting partial data.

It does not:

- Read cookies
- Intercept network traffic
- Call undocumented LeetCode APIs
- Crawl other problems
- Write captured code or attempts without a user-confirmed outcome click

## Deterministic browser tests

Tests use temporary Chromium profiles, synthetic credentials, public-DOM-shaped LeetCode pages,
and a stateful synthetic Notion REST fixture. The harness intercepts worker traffic before dispatch
and blocks unknown destinations; it never loads `.env` or falls through to a real tracker. Forced
worker termination and browser restarts run only against this disposable profile. Test outputs and
screenshots contain synthetic data and live under ignored `build/` or temporary directories.
Production code has no interception or test endpoint path.

## Migration review

Latest-Attempt retention keeps compact retry receipts in the existing Notion Attempt page. An
unfinished update temporarily stores its user-confirmed code payload in a managed receipt block;
successful recovery replaces that block with code-free receipt metadata. Only the managed captured
code block is updated; unrelated notes are preserved. The narrow bridge API is unchanged.

`npm run notion:latest` reads all Attempt properties and nested page bodies and writes a local
mode-0600 backup under ignored `build/`, printing only IDs, counts, warnings and the backup hash.
It never trashes pages. `--apply-grind-link` changes only the Grind formula, its optional one-way
Attempt relation and that relation's values on Grind-only duplicate rows, with read-back checks.
Historical removal requires separate approval after review and preservation of retry receipts.
`notion:latest:cleanup` requires that approved backup and its SHA-256, writes a token-free local audit,
and moves only the exact checked older pages to recoverable Notion Trash. It refuses changed
properties, bodies, unapproved pages, or extra notes on deletion candidates. Run it with every tracker writer
stopped; Notion does not provide a transaction spanning capture writes and cleanup.

Run `npm run notion:migrate:v2` without flags first. Inspect the reported backup path and counts before
running `npm run notion:migrate:v2 -- --apply`. Backups preserve legacy practice data and may contain
personal notes or code-adjacent reflections, so keep `build/` local and ignored even though it is
token-free.
Use the same review-before-apply sequence for `npm run notion:migrate:v3` and
`npm run notion:migrate:v4`.
