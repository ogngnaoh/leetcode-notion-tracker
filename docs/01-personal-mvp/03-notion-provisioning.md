# Slice 03: Real Notion provisioning

Goal: Provision the exact two-database tracker once in the owner's real Notion workspace and verify its schema and secret-free manifest.

## Remaining checklist

- [ ] Confirm `.env` is present and privately contains the required Notion and bridge values.
- [ ] Confirm the shared Notion parent page is empty before setup.
- [ ] Run `npm run notion:setup` exactly once.
- [ ] Run `npm run notion:verify` against the created databases.
- [ ] Confirm exactly two databases and one primary data source per database.
- [ ] Confirm every required property and the reciprocal `Problem`/`Attempts` relation.
- [ ] Inspect `build/notion-manifest.json` for IDs only and no credential material.
- [ ] Record observed evidence without secrets.
- [ ] Ship this slice, activate bridge verification, and rewrite the handoff.

## Record

- 2026-07-20: Activated after retry safety shipped with 25 passing tests.
