# Slice 03: Real Notion provisioning

Goal: Provision the exact two-database tracker once in the owner's real Notion workspace and verify its schema and secret-free manifest.

## Remaining checklist

- [x] Confirm `.env` is present and privately contains the required Notion and bridge values.
- [x] Confirm the shared Notion parent page is empty before setup.
- [x] Run `npm run notion:setup` exactly once.
- [x] Run `npm run notion:verify` against the created databases.
- [x] Confirm exactly two databases and one primary data source per database.
- [x] Confirm every required property and the reciprocal `Problem`/`Attempts` relation.
- [x] Inspect `build/notion-manifest.json` for IDs only and no credential material.
- [x] Record observed evidence without secrets.
- [x] Ship this slice, activate bridge verification, and rewrite the handoff.

## Record

- 2026-07-20: Activated after retry safety shipped with 25 passing tests.
- 2026-07-20: Confirmed private configuration without printing values, changed `.env` permissions from `644` to owner-only `600`, and confirmed the manifest was absent.
- 2026-07-20: A read-only API call confirmed the shared parent contained zero children before setup.
- 2026-07-20: Ran `npm run notion:setup` exactly once. It created Problems, Attempts, the reciprocal relation, and the local manifest without partial failure.
- 2026-07-20: `npm run notion:verify` verified 13 Problems properties and 20 Attempts properties.
- 2026-07-20: A separate read-only inventory confirmed exactly two database children, one primary data source per database, correct reciprocal relation targets, and no token or bridge credential in the manifest.
