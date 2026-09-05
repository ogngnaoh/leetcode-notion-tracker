# Minimal implementation plan

> Historical implementation record. For current operation, use the [documentation index](README.md).

This is the order for completing the project with real credentials.

## Phase 1: Baseline

- Run `npm install`.
- Run `npm run check`.
- Read the source and confirm no Notion credential reaches extension code.

## Phase 2: Notion

- Create an internal integration.
- Share one empty parent page.
- Configure `.env`.
- Run `npm run notion:setup` once.
- Run `npm run notion:verify`.
- Compare the actual schema with `docs/NOTION_SCHEMA.md`.

## Phase 3: Bridge

- Start `npm run dev:bridge`.
- Run the same sample capture twice.
- Verify idempotency and review state in Notion.
- Test invalid payload and invalid bridge token behavior.

## Phase 4: Chrome

- Build and load the unpacked extension.
- Configure bridge settings.
- Test metadata extraction on Easy, Medium, and client-side navigation.
- Log one live attempt.
- Modify selectors only when live testing proves a mismatch.

## Phase 5: Release checkpoint

- Run `npm run check`.
- Repeat `npm run notion:verify`.
- Confirm no secrets in `git diff`, `dist/extension`, or committed files.
- Update `STATUS.md` with only verified claims.
- Initialize Git and commit the MVP.
