# Security and privacy

## Secrets

`NOTION_TOKEN` exists only in `.env` on the machine running the bridge and setup script.

The v1→v2 migration uses that same local token and never prints or serializes it. Dry-run and apply
write JSON backups only under ignored `build/`; backups contain manifest/shape metadata, page IDs,
and legacy field values, but never environment variables, headers, auth objects, clients, or tokens.
Console output is limited to the backup path, counts, and planned/applied operation counts.
Apply also writes an atomic token-free recovery journal under ignored `build/`. The journal contains
only the original backup path, manifest/API identifiers, schema shapes, page IDs, original legacy
values, and prepared backfill expectations; it is deleted after the version-2 manifest succeeds.
Those expectations are validated against exact migration-owned keys and value shapes, and the
journal's SHA-256 binding plus the backup's exact structure are verified before recovery writes.
The v2→v3 path uses the same token-free boundary for page IDs and `First Solved` recovery values.
The v3→v4 path also stores only schema metadata, page IDs, captured field values, and expected
first-Attempt/reclassification values. Its SHA-256-bound backup and journal remain local under ignored
`build/` and the journal is retained until the version-4 manifest is durable.

The extension stores:

- Bridge URL
- Personal bridge token
- Per-tab, session-scoped pending retry bodies and last-success presentation records
- A versioned Daily Reps record containing the 1–100 goal, public problem metadata, timestamps, the
  active repetition list, and manually completed session archives

Daily Reps never stores captured code, language, outcomes, bridge credentials, or Notion IDs. It is
kept in `chrome.storage.local`, is not cloud-synced, and is removed when extension storage is cleared
or the extension is uninstalled. Mutations are serialized by the background worker and accepted only
from extension-owned pages; a malformed stored record is reported without being overwritten.

The bridge token authorizes only the narrow bridge endpoint. It is not a Notion credential.

The public dashboard HTML contains no bridge or Notion credential. Its settings form receives one
random anti-forgery token for the lifetime of the bridge process and must echo it in the custom
`X-LC-Dashboard-Token` header to `POST /dashboard/settings`. The route has no CORS policy, so a
cross-origin page cannot read the token or send the custom header. CSP remains default-deny and allows
only same-origin scripts, styles, images, fonts, and the settings connection. The route can change only
the integer `dailyNewProblemGoal` from 1 through 100; it is not a generic file or Notion proxy.

The saved dashboard preference lives in ignored `build/dashboard-settings.json`. It contains no
token or Notion data, is replaced atomically, and is never copied into extension storage or output.

## Local-first default

The bridge binds to `127.0.0.1`, not every network interface. The extension manifest grants bridge access only to localhost on port 8787.
The Dock launcher stores no credentials, sources no shell environment file, and prints no secret
values. Finder documents Terminal.app as the default handler for `lc-log.command`, while direct shell
and alternate-terminal launches remain supported. Every launch starts the same bridge in a visible
foreground terminal only after an explicit action; there is no LaunchAgent, login item, cloud secret,
or Notion token in extension storage.
Its temporary startup claim contains only a process ID and is never used to transport credentials.

## LeetCode access

The extension reads only the active `leetcode.com/problems/*` page. Problem title, difficulty, and
topics come from the public DOM through the declared read-only content script. Captured code and
language come from Monaco's editor model, read by a second declared content script running in the
page's own JavaScript world, which answers nonce-matched requests over `window.postMessage`. The side
panel reinjects both scripts once after an extension reload. Neither script focuses, scrolls, or
otherwise mutates the page.

Because the model reader runs in the page's world, a hostile page could forge a reply and supply code
the user did not write. This is not a new exposure: the page already controls every element the
extension reads. Replies are validated for shape and matched against a per-request nonce, and a
missing reply blocks capture rather than substituting partial data.

It does not:

- Read cookies
- Intercept network traffic
- Call undocumented LeetCode APIs
- Crawl other problems
- Send data without a user-confirmed outcome click

## Deterministic browser tests

The Playwright MV3 suite uses a synthetic bridge token and binds its own mock exclusively to
`127.0.0.1:8787`. If that port is unavailable, the suite fails with instructions to stop the real
bridge; it never falls through to a live local service. The fixture substitutes only top-level
LeetCode problem navigations with in-memory public-DOM-shaped HTML and does not read cookies, route
application API traffic, contact LeetCode APIs, or load `.env` credentials. Temporary Chromium
profiles and Playwright results live outside source control and are removed or kept under ignored
`build/` paths.

## Migration review

Run `npm run notion:migrate:v2` without flags first. Inspect the reported backup path and counts before
running `npm run notion:migrate:v2 -- --apply`. Backups preserve legacy practice data and may contain
personal notes or code-adjacent reflections, so keep `build/` local and ignored even though it is
token-free.
Use the same review-before-apply sequence for `npm run notion:migrate:v3` and
`npm run notion:migrate:v4`.

## Before remote deployment

Remote deployment is outside the MVP. Before exposing the bridge publicly, add:

- HTTPS
- Origin allowlisting
- Rotatable device credentials
- Request-size limits
- Rate limiting
- Structured secret-safe logging
- Deployment-specific host permissions in `manifest.json`
