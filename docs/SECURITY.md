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

The extension stores:

- Bridge URL
- Personal bridge token
- Per-tab, session-scoped pending retry bodies and last-success presentation records

The bridge token authorizes only the narrow bridge endpoint. It is not a Notion credential.

## Local-first default

The bridge binds to `127.0.0.1`, not every network interface. The extension manifest grants bridge access only to localhost on port 8787.

## LeetCode access

The extension reads only the active `leetcode.com/problems/*` page after Chrome injects the declared
content script or the side panel reinjects that same read-only script once after an extension reload.
It reads public rendered Monaco lines, gutter positions, and scrollbar state without focusing or
scrolling the page. It does not:

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

## Before remote deployment

Remote deployment is outside the MVP. Before exposing the bridge publicly, add:

- HTTPS
- Origin allowlisting
- Rotatable device credentials
- Request-size limits
- Rate limiting
- Structured secret-safe logging
- Deployment-specific host permissions in `manifest.json`
