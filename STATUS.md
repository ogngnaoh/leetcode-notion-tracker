# Scaffold status

## Implemented and locally verifiable

- Strict TypeScript project
- Zod capture contract
- Stable problem keys
- Review-state transition logic
- Idempotent capture service contract
- In-memory repository for tests
- Hono health and capture routes
- Bearer-token protection for capture writes
- Direct Notion API repository
- One-time two-database setup command
- Schema verification command
- MV3 side-panel extension
- LeetCode current-page metadata extraction
- Extension settings page
- Manual capture form
- Extension production build
- Unit and route tests

## Requires your credentials or browser session

- Running `notion:setup` against your actual workspace
- Confirming current LeetCode DOM selectors on the live website
- Loading the unpacked extension in Chrome
- End-to-end write verification in your Notion workspace

## Intentionally deferred

- Cloud deployment
- Offline queue
- Automatic accepted-submission prompt
- Automatic code capture
- Multiple tracker schemas
- Notion OAuth for other users
- Recruiting/application tracking
