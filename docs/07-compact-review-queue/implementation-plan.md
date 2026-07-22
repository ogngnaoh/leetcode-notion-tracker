# Compact Review Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compact, searchable dashboard that keeps all overdue and today reviews, excludes future reviews, and remains usable with hundreds of Problems.

**Architecture:** Keep the Notion-backed `DashboardSnapshot` and server-rendered HTML. Enforce the cutoff at the repository boundary, render rows with non-secret filter metadata, and add dependency-free client filtering and 50-row disclosure.

**Tech Stack:** TypeScript 5.9, Hono, browser-native HTML/CSS/JavaScript, Vitest 4, Playwright 1.61.

## Global Constraints

- Keep exactly two Notion databases and do not change the review schedule, capture contract, schema, or managed views.
- Keep `Next Review <= today`; exclude all future dates.
- Do not persist filters or add server pagination, React, another framework, or another database.
- Preserve safe LeetCode links, stale/loading/unavailable states, keyboard access, and manual review.
- Obtain user review of each changed test before its first execution.
- Synchronize `package.json`, root `package-lock.json`, and `extension/manifest.json` at `0.1.5`.
- Changed tests are development evidence; the unchanged `npm run check` is the completion check.

---

### Task 1: Enforce the inclusive due boundary

**Files:**
- Modify: `test/notion-repository.test.ts`
- Modify: `src/bridge/notion-repository.ts`

**Interfaces:**
- Consumes: `loadDashboard(date: string)` and mapped `DashboardRow.nextReview` values.
- Produces: snapshots whose `due` rows all satisfy `nextReview <= date`.

- [ ] **Step 1: Write the failing boundary test**

Make the existing pagination test return overdue `2026-07-20`, today `2026-07-21`, and future `2026-07-22` rows while retaining this expectation:

```ts
await expect(repository(fake).loadDashboard('2026-07-21')).resolves.toMatchObject({
  newProblemCount: 2,
  due: [{ title: 'Zeta' }, { title: 'Alpha' }],
});
```

- [ ] **Step 2: Obtain review, then verify RED**

Run `npx vitest run test/notion-repository.test.ts -t "fully paginates new Problems and due reviews"`.
Expected: FAIL because `Future` appears.

- [ ] **Step 3: Add the minimal boundary filter**

Keep mapping and validation unchanged, then append:

```ts
.filter((row) => row.nextReview <= date);
```

- [ ] **Step 4: Verify GREEN and commit**

Run the same command; expect one pass. Commit the two files as `fix: enforce dashboard review cutoff`.

---

### Task 2: Render compact queue structure and counts

**Files:**
- Modify: `test/dashboard.test.ts`
- Modify: `test/dashboard-fixtures.test.ts`
- Modify: `src/bridge/dashboard.ts`
- Modify: `src/bridge/dashboard-fixtures.ts`

**Interfaces:**
- Consumes: boundary-checked `DashboardSnapshot.date` and `due`.
- Produces: `data-review-queue`, `data-review-search`, `data-review-filter`, `data-review-row`, `data-review-results`, `data-review-empty`, and `data-review-more` elements.

- [ ] **Step 1: Write failing renderer tests**

Render three rows: overdue Needed-help Medium, today Solved Easy, and overdue Needed-help Hard. Assert:

```ts
expect(html).toContain('data-review-queue');
expect(html).toContain('data-review-search');
expect(html).toContain('data-review-filter="all"');
expect(html).toContain('data-review-filter="today"');
expect(html).toContain('data-review-filter="overdue"');
expect(html).toContain('data-review-filter="needed-help"');
expect(html).toContain('data-review-filter="hard"');
expect(html).toContain('data-filter-count="all">3</span>');
expect(html).toContain('data-filter-count="today">1</span>');
expect(html).toContain('data-filter-count="overdue">2</span>');
expect(html).toContain('data-filter-count="needed-help">2</span>');
expect(html).toContain('data-filter-count="hard">1</span>');
expect(html).not.toContain('<table>');
expect(html).not.toContain('class="cards"');
```

Keep all existing escaping, unsafe-link, secret, state, and settings assertions. Assert normal/stale fixtures contain the queue and other fixtures keep their state messages.

- [ ] **Step 2: Obtain review, then verify RED**

Run `npx vitest run test/dashboard.test.ts test/dashboard-fixtures.test.ts`.
Expected: FAIL because the renderer emits table/cards without compact controls.

- [ ] **Step 3: Implement renderer helpers and markup**

Use date-only UTC arithmetic:

```ts
function dueLabel(reviewDate: string, snapshotDate: string): string {
  const review = Date.parse(`${reviewDate}T00:00:00Z`);
  const snapshot = Date.parse(`${snapshotDate}T00:00:00Z`);
  const days = Math.round((snapshot - review) / 86_400_000);
  return days === 0 ? 'Today' : `${days}d overdue`;
}
```

Compute counts from the complete `rows` collection for all, exact today, overdue, Needed help, and Hard. Render native filter buttons with counts and `aria-pressed`, a labeled title search, dense list rows, polite status, filter-empty state, and load button. Each row keeps escaped display values, validated link behavior, and these attributes:

```html
data-review-row
data-title="normalized title"
data-review-date="YYYY-MM-DD"
data-practice-state="Needed help"
data-difficulty="Hard"
```

- [ ] **Step 4: Add complete fixtures**

Make normal contain all three filter cases at or before `2026-07-21`. Add `large` with 123 due rows, extend `DashboardFixtureName`, and allow `/dashboard/large`.

- [ ] **Step 5: Verify GREEN and commit**

Run the same Vitest command; expect all passes. Commit the four files as `feat: render compact review queue`.

---

### Task 3: Add filtering, search, batches, and responsive layout

**Files:**
- Modify: `test/browser/dashboard.spec.ts`
- Modify: `src/bridge/assets/dashboard.js`
- Modify: `src/bridge/assets/dashboard.css`

**Interfaces:**
- Consumes: Task 2's compact data attributes.
- Produces: one active view, combined search, and a visible limit that advances by 50.

- [ ] **Step 1: Write failing browser tests**

On normal, prove all three rows show; Today shows only Two Sum; Needed help combined with search `median` shows only Median of Two Sorted Arrays. On large, prove 50, 100, then 123 visible rows and a hidden load button, then prove changing filter resets the limit. At 375px prove filter controls remain reachable and:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
  true,
);
```

- [ ] **Step 2: Obtain review, then verify RED**

Run `npx playwright test test/browser/dashboard.spec.ts`.
Expected: FAIL because the controls have no filtering or disclosure behavior.

- [ ] **Step 3: Implement the queue controller**

Initialize only when all compact elements exist and maintain:

```js
let activeFilter = 'all';
let visibleLimit = 50;
const batchSize = 50;
```

Match normalized title search plus the selected filter. Hide nonmatches and matches beyond the limit, update `aria-pressed`, announce `Showing X of Y matching reviews`, toggle the filter-empty state, and show load more only when matches remain. Filter/search changes reset to 50; load clicks add 50. Use no `innerHTML` and no request.

- [ ] **Step 4: Implement layout B styling**

Keep tokens, badges, dialog, stale banner, and reduced motion. Tighten masthead and summaries; add a two-column queue with narrow filter rail and dense rows. Below 640px, make filters horizontal chips, wrap row metadata, keep the action reachable, and prevent page overflow.

- [ ] **Step 5: Verify GREEN, regressions, and commit**

Run:

```bash
npx playwright test test/browser/dashboard.spec.ts
npx vitest run test/notion-repository.test.ts test/dashboard.test.ts test/dashboard-fixtures.test.ts test/app.test.ts
```

Expect all passes. Commit the three task files as `feat: filter compact review backlog`.

---

### Task 4: Release, verify, and ship milestone 07

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `extension/manifest.json`
- Modify: `README.md`
- Modify: `STATUS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/milestones.md`
- Modify: `docs/07-compact-review-queue/milestone.md`
- Rewrite: `docs/07-compact-review-queue/handoff.md`

**Interfaces:**
- Consumes: Tasks 1–3 and the unchanged completion check.
- Produces: synchronized LCTrack `0.1.5` and shipped milestone records.

- [ ] **Step 1: Synchronize version and docs**

Set only the root product versions to `0.1.5`. Document `Next Review <= today`, defensive future exclusion, compact saved views, search, batches of 50, and that filters never mutate Notion.

- [ ] **Step 2: Format and run the completion check**

Run:

```bash
npm run format
npm run check
```

Expected: formatting, TypeScript, all Vitest tests, all Playwright scenarios, extension build, and security scan exit 0.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD
```

Expected: no whitespace errors and only milestone 07 implementation, tests, metadata, and docs.

- [ ] **Step 4: Ship records and stop processes**

Mark slice 1 and milestone 07 shipped. Rewrite handoff with exactly the three required sections, fresh check counts, and the changed-test limitation. Stop the visual companion and fixture server.

- [ ] **Step 5: Commit the release**

Commit release metadata and records as `chore: release LCTrack 0.1.5`.
