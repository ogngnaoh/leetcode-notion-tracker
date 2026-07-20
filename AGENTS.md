# Agent instructions

This repository is a deliberately lean personal MVP.

Before changing code, read:

1. `README.md`
2. `STATUS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/NOTION_SCHEMA.md`
5. `CODEX_HANDOFF_PROMPT.md`

## Non-negotiable boundaries

- Keep exactly two Notion databases for the MVP: Problems and Attempts.
- Keep the Notion token out of extension source, storage, logs, and build output.
- Keep the bridge API narrow; do not create a generic Notion proxy.
- Keep capture user-confirmed.
- Do not use private LeetCode APIs, cookies, request interception, or bulk scraping.
- Do not introduce React, Next.js, a monorepo framework, an ORM, a database, OAuth, Docker, or cloud infrastructure unless the user explicitly expands scope.
- Preserve `External Key` and `Client Event ID` idempotency.
- Write a failing test before changing behavior.
- Run `npm run check` before claiming completion.
