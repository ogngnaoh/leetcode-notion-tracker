# Repeatable Grind recovery

The checked-in `config/grind-curriculum.json` is the intended curriculum: 120 slots, six days,
20 problems per day, and A/B/C blocks of 7/7/6. It contains public problem metadata, not progress,
Notion credentials, or workspace IDs. The initial list came from the complete September 2, 2026
backup and matched the live schedule, titles, URLs, slugs, and keys on October 4, 2026.
The initial repair also restored one blank problem number. It does not scrape LeetCode.

## Everyday controls

From this repository, with the existing local `.env` and v4 manifest:

```bash
npm run notion:grind:check
npm run notion:grind:repair
```

`check` makes no Notion writes. Exit 0 means healthy, 2 means drift or a blocker, and 1 means the
check could not finish. It checks exact original page IDs, curriculum fields, extra scheduled rows,
source/day database locks, the home/day page locks, and six daily view configurations.

`repair` is an explicit write command. It previews its changes, refuses blockers before any writes,
saves a mode-0600 before-change backup in `build/`, applies only differences, and reads back each
change. A healthy rerun makes no Notion writes. If interrupted, rerun `check`, then `repair`.
No background process or automatic repair runs. Avoid simultaneous manual curriculum edits or
extension/bridge captures during maintenance; Notion does not provide cross-request transactions.

Repairs:

- Restore the **original page ID** from Trash when still accessible.
- Restore title, number, URL, slug, External Key, day, block, and order.
- Lock the Problems database, the six daily linked database containers, and home/day pages.
- Show only Problem, Grind Done, and Solution in daily tables; preserve the day filter,
  ascending curriculum order, and A/B/C grouping.

Repairs never write Grind Done, review state, attempt dates, relations, solution bodies, or notes.
Existing reset buttons and the home progress summary remain intact. Resetting checkboxes is a
separate, deliberate action using the existing Notion reset controls.

These locks reduce accidental edits; they do not enforce checkbox-only permissions or prevent
an editor from deleting rows. Check/repair is recovery on demand, not continuous enforcement.
The commands run locally; a native Notion button cannot launch this local CLI without an additional
service. No service is required or installed.

## Back up the recovery bindings

Keep `build/grind-state.json` with your token-free `build/notion-manifest.json`. It maps each slot
to its original Notion page and each day to its existing page/view. It is intentionally ignored by
Git, alongside repair snapshots and replacement journals. Copy it to your normal private backup.
The curriculum alone can reproduce the roster but cannot recover lost checkmarks or page bodies.

Initialization is one-time and refuses to overwrite existing state. To recover lost state, prefer
a copy of `grind-state.json`. Otherwise use an intact pre-deletion latest-attempt backup containing
the exact curriculum, plus the existing home and six day page IDs in day order:

```bash
npm run notion:grind:init -- \
  --backup build/notion-latest-preview-TIMESTAMP.json \
  --home HOME_PAGE_UUID \
  --days DAY1_UUID,DAY2_UUID,DAY3_UUID,DAY4_UUID,DAY5_UUID,DAY6_UUID
```

Initialization reads Notion to bind existing linked tables but makes no Notion changes. It does
not adopt the current roster as truth. Preserve the state after replacements; an older initialization
backup still points at original IDs. Editing the curriculum invalidates the state hash and requires
an intentional maintenance update, not automatic adoption of new contents.

## Unavailable or permanently deleted rows

A Notion 404 can mean missing access. Normal repair therefore stops instead of creating a duplicate.
Check sharing and Trash first. Restore accessible originals with `repair`.

Only after confirming the original is permanently gone, use the reported slot:

```bash
npm run notion:grind:replace -- --slot day-4-12 --confirm-unavailable yes
```

Replacement refuses retrievable originals and existing scheduled candidates. It creates exactly
one new checklist row, starts it unchecked, keeps the same External Key, and links the newest
existing saved Attempt through Grind Attempt when available. It does not alter any Attempt's
Problem relation, receipt, Client Event ID, code, or review history. Lost problem-page notes and
progress cannot be reconstructed from the curriculum; recover those from a separate backup.

Before creating, it durably records a unique intent in `build/grind-replacement-SLOT.json`.
A returned page ID is saved before the slot binding changes. After an ambiguous create response,
**never delete the journal to retry**. Inspect Notion for the page containing the exact
`Grind replacement receipt: UUID` from the journal. Once its ID is known:

```bash
npm run notion:grind:replace -- --slot day-4-12 --confirm-unavailable yes --resume-page PAGE_UUID
```

Resume verifies the receipt and curriculum before binding the replacement. If no matching page
can be found, the outcome stays unresolved; an empty query does not prove creation failed.
The command never automatically resends a create. If the original later returns, check reports the
extra scheduled page and stops for inspection rather than deleting either page.

If a process was killed, `build/grind-maintenance.lock` may remain. Verify no other Grind command
is running before removing that local lock file. Never remove a replacement journal to clear a lock.

## Scope

This feature keeps the two existing data sources and uses only official Notion REST operations.
It does not repair deleted parent pages, missing views, schema changes, or native reset-button
internals. Those conditions stop the audit and require recovery from Notion Trash/history or the
locked master template. Before-change backups are token-free but can contain private properties;
keep them local. Tokens remain in the existing ignored CLI `.env` and never enter these artifacts
or extension source/builds.
