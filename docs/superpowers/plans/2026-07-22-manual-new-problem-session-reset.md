# Manual New-Problem Session Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count first-time Problems automatically from a user-controlled session boundary, with a confirmed local reset and configurable maximum.

**Architecture:** Extend the atomic local settings document with an optional ISO session timestamp. Pass that timestamp into the existing Notion dashboard query, expose a narrow authenticated reset operation, and update the rendered counter immediately after persistence without mutating Notion.

**Tech Stack:** TypeScript, Hono, Notion API client, vanilla browser JavaScript, Vitest, Playwright.

## Global Constraints

- Reset must never write to Notion or change Problems, Attempts, review state, captured code, or idempotency identifiers.
- Existing settings without `newProblemSessionStartedAt` retain calendar-day counting until the first reset.
- The bridge generates the reset timestamp and persists it atomically before changing in-memory state.
- `POST /dashboard/settings` accepts exactly `{ "dailyNewProblemGoal": number }` or `{ "resetNewProblemSession": true }`.
- Keep the anti-forgery token, same-origin route, no-CORS behavior, two-database architecture, and synchronized release version `0.1.7`.

---

### Task 1: Persist the session boundary

**Files:**

- Modify: `test/dashboard-settings.test.ts`
- Modify: `src/bridge/dashboard-settings.ts`

**Interfaces:**

- Produces: `DashboardSettings { dailyNewProblemGoal: number; newProblemSessionStartedAt?: string }`
- Produces: `DashboardSettingsStore.save(settings: DashboardSettings): Promise<void>`

- [ ] **Step 1: Write failing persistence tests**

Add tests that load the legacy goal-only JSON, load a valid goal-plus-ISO-boundary JSON, reject malformed timestamps, preserve the boundary while changing the goal, atomically save a reset boundary, and serialize concurrent full-settings saves.

- [ ] **Step 2: Verify the tests fail for the missing boundary support**

Run: `npm test -- test/dashboard-settings.test.ts`

Expected: failures show that the current exact parser rejects `newProblemSessionStartedAt` and `save` accepts only a number.

- [ ] **Step 3: Implement strict settings parsing and atomic full-document saves**

Validate timestamps by requiring a string whose `new Date(value).toISOString()` equals the input. Keep the property optional for legacy files. Make each queued save persist the complete validated settings object, so changing one field cannot discard the other.

- [ ] **Step 4: Verify the persistence tests pass**

Run: `npm test -- test/dashboard-settings.test.ts`

Expected: all dashboard-settings tests pass with no warnings.

### Task 2: Query and store the session count

**Files:**

- Modify: `test/notion-repository.test.ts`
- Modify: `test/dashboard.test.ts`
- Modify: `src/bridge/notion-repository.ts`
- Modify: `src/bridge/dashboard.ts`
- Modify: `src/bridge/server.ts`

**Interfaces:**

- Produces: `loadDashboard(date: string, newProblemSessionStartedAt?: string)` using `date.equals` before the first reset and `date.after` afterward.
- Produces: `DashboardStore.currentSessionStartedAt()` and `updateSessionStartedAt(timestamp)`.

- [ ] **Step 1: Write failing repository and store tests**

Require the legacy `{ property: 'First Attempt', date: { equals: date } }` filter without a boundary, the strict `{ property: 'First Attempt', date: { after: timestamp } }` filter with one, and an immediate in-memory count of zero after `updateSessionStartedAt` without a Notion mutation.

- [ ] **Step 2: Verify the focused tests fail for missing session behavior**

Run: `npm test -- test/notion-repository.test.ts test/dashboard.test.ts`

Expected: failures identify the missing boundary parameter and store update method.

- [ ] **Step 3: Implement the query and store boundary**

Thread the optional saved timestamp from `server.ts` into `DashboardStore`, pass it to the repository load callback, and have a successful reset replace only `newProblemCount` with zero plus the in-memory boundary. Leave due rows, goal, and all Notion write paths untouched.

- [ ] **Step 4: Verify the focused tests pass**

Run: `npm test -- test/notion-repository.test.ts test/dashboard.test.ts`

Expected: repository pagination and dashboard store tests pass.

### Task 3: Add the authenticated reset operation

**Files:**

- Modify: `test/app.test.ts`
- Modify: `src/bridge/app.ts`
- Modify: `src/bridge/server.ts`

**Interfaces:**

- Consumes: `DashboardSettingsStore.save(settings)` and `DashboardStore.updateSessionStartedAt(timestamp)`.
- Produces: reset response `{ dailyNewProblemGoal: number; newProblemCount: 0; newProblemSessionStartedAt: string }`.

- [ ] **Step 1: Write failing route tests**

Cover successful bridge-generated reset time, anti-forgery rejection, rejection of browser-supplied timestamps and mixed/extra fields, persistence-before-memory ordering, and unchanged count/boundary on save failure.

- [ ] **Step 2: Verify the route tests fail**

Run: `npm test -- test/app.test.ts`

Expected: reset payloads currently return 400.

- [ ] **Step 3: Implement the two exact request shapes**

Branch only after exact key validation. Preserve the saved boundary on goal updates, generate reset time from the app clock, save the complete settings object, then update dashboard memory. Return the fixed existing error on persistence failure without logging secrets.

- [ ] **Step 4: Verify the route tests pass**

Run: `npm test -- test/app.test.ts`

Expected: all bridge app tests pass.

### Task 4: Add confirmed reset controls

**Files:**

- Modify: `test/dashboard.test.ts`
- Modify: `test/browser/dashboard.spec.ts`
- Modify: `src/bridge/dashboard.ts`
- Modify: `src/bridge/assets/dashboard.js`
- Modify: `src/bridge/assets/dashboard.css`
- Modify: `src/bridge/dashboard-fixtures.ts`

**Interfaces:**

- Consumes: reset response from Task 3.
- Produces: `NEW PROBLEMS THIS SESSION`, a `Reset current count` button, confirmation dialog, and immediate count update through `[data-dashboard-new-problem-count]`.

- [ ] **Step 1: Write failing renderer and browser tests**

Require session copy, stable counter hook, cancel-without-request, confirmed exact reset payload, immediate `0 / maximum`, focus restoration, error retention, and mobile no-overflow behavior.

- [ ] **Step 2: Verify renderer tests fail**

Run: `npm test -- test/dashboard.test.ts`

Expected: failures show the old daily copy and missing reset controls.

- [ ] **Step 3: Implement accessible confirmation and reset flow**

Use a second native `<dialog>` owned by the settings UI rather than `window.confirm`. Disable relevant controls during the request, update only the counter after a valid response, close both dialogs on success, and keep the confirmation visible with an error on failure.

- [ ] **Step 4: Verify renderer and dashboard browser tests pass**

Run: `npm test -- test/dashboard.test.ts && npm run test:browser -- test/browser/dashboard.spec.ts`

Expected: renderer tests and all dashboard Playwright scenarios pass at desktop and 375px.

### Task 5: Release, documentation, and completion audit

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `extension/manifest.json`
- Modify: `test/extension-sidepanel-static.test.ts`
- Modify: `README.md`
- Modify: `STATUS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/07-compact-review-queue/milestone.md`
- Rewrite: `docs/07-compact-review-queue/handoff.md`

**Interfaces:**

- Produces: synchronized release `0.1.7` and current project records.

- [ ] **Step 1: Update the release assertion first and verify it fails**

Set the manifest assertion to `0.1.7`, run `npm test -- test/extension-sidepanel-static.test.ts`, and confirm it fails against `0.1.6`.

- [ ] **Step 2: Synchronize versions and documentation**

Set all four version entries to `0.1.7`. Document session counting, confirmed local-only reset, backward-compatible pre-reset daily behavior, and unchanged Notion/review/capture contracts. Rewrite the handoff with exact fresh evidence.

- [ ] **Step 3: Run focused and full verification**

Run `npm run check`, `git diff --check`, a script asserting all version entries equal `0.1.7`, and live desktop/mobile dashboard inspection after restarting the fixture server. Confirm four review filters, retained Hard badges, reset confirmation/cancellation/success, no horizontal overflow, and no relevant console warnings/errors.

- [ ] **Step 4: Audit and close out**

Inspect the complete diff and working-tree status, confirm only intended files changed, stop fixture/browser processes, commit the implementation and release records, and mark the active goal complete only after every spec requirement has direct evidence.
