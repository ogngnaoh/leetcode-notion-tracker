import { serve, type ServerType } from '@hono/node-server';
import { expect, test } from '@playwright/test';
import { createDashboardFixtureApp } from '../../src/bridge/dashboard-fixtures.js';

test.describe.configure({ mode: 'serial' });

let server: ServerType;

test.beforeAll(async () => {
  server = serve({ fetch: createDashboardFixtureApp().fetch, port: 8791, hostname: '127.0.0.1' });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('filters the normal review queue and combines the active view with title search', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8791/dashboard/normal');

  const visibleTitles = page.locator('[data-review-row]:visible h2');
  await expect(visibleTitles).toHaveText([
    'Median of Two Sorted Arrays',
    'Encode and Decode Strings',
    'Two Sum',
  ]);

  const today = page.getByRole('button', { name: /Today/ });
  await today.focus();
  await page.keyboard.press('Enter');
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(visibleTitles).toHaveText(['Two Sum']);

  const neededHelp = page.getByRole('button', { name: /Needed help/ });
  await neededHelp.focus();
  await page.keyboard.press('Space');
  await page.getByRole('searchbox', { name: 'Search by title' }).fill('median');
  await expect(neededHelp).toHaveAttribute('aria-pressed', 'true');
  await expect(visibleTitles).toHaveText(['Median of Two Sorted Arrays']);
});

test('reveals large review queues in batches of 50 and resets disclosure on filter changes', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8791/dashboard/large');

  const visibleRows = page.locator('[data-review-row]:visible');
  const loadMore = page.getByRole('button', { name: 'Load 50 more' });
  await expect(visibleRows).toHaveCount(50);
  await expect(loadMore).toBeVisible();

  await loadMore.click();
  await expect(visibleRows).toHaveCount(100);

  await loadMore.click();
  await expect(visibleRows).toHaveCount(123);
  await expect(loadMore).toBeHidden();

  await page.getByRole('button', { name: /Overdue/ }).click();
  await expect(visibleRows).toHaveCount(50);
  await expect(loadMore).toBeVisible();
});

test('keeps review filters reachable without page overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://127.0.0.1:8791/dashboard/normal');

  const filters = page.getByRole('group', { name: 'Review filters' }).getByRole('button');
  await expect(filters).toHaveCount(4);
  await expect(page.locator('[data-review-filter="hard"]')).toHaveCount(0);
  for (const filter of await filters.all()) {
    await filter.scrollIntoViewIfNeeded();
    await expect(filter).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('saves the daily goal, closes the dialog, and updates the denominator immediately', async ({
  page,
}) => {
  await page.route('**/dashboard/settings', async (route) => {
    expect(route.request().headers()['x-lc-dashboard-token']).toBe('fixture-dashboard-token');
    expect(route.request().postDataJSON()).toEqual({ dailyNewProblemGoal: 14 });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dailyNewProblemGoal: 14 }),
    });
  });
  await page.goto('http://127.0.0.1:8791/dashboard/normal');

  const opener = page.locator('#open-dashboard-settings');
  await opener.click();
  await expect(page.locator('#dashboard-settings-dialog')).toBeVisible();
  await expect(page.locator('#daily-new-problem-goal')).toHaveValue('10');
  const labelBox = await page.getByText('Maximum new problems', { exact: true }).boundingBox();
  const inputBox = await page.locator('#daily-new-problem-goal').boundingBox();
  expect(labelBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y - (labelBox!.y + labelBox!.height)).toBeGreaterThanOrEqual(10);
  await page.locator('#daily-new-problem-goal').fill('14');
  await page.getByRole('button', { name: 'Save maximum' }).click();

  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(page.locator('[data-dashboard-goal]')).toHaveText(' / 14');
  await expect(opener).toBeFocused();
});

test('cancels or confirms a deliberate new-problem session reset', async ({ page }) => {
  let resetRequests = 0;
  await page.route('**/dashboard/settings', async (route) => {
    resetRequests += 1;
    expect(route.request().headers()['x-lc-dashboard-token']).toBe('fixture-dashboard-token');
    expect(route.request().postDataJSON()).toEqual({ resetNewProblemSession: true });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dailyNewProblemGoal: 10,
        newProblemCount: 0,
        newProblemSessionStartedAt: '2026-07-22T15:00:00.000Z',
      }),
    });
  });
  await page.goto('http://127.0.0.1:8791/dashboard/normal');

  await page.locator('#open-dashboard-settings').click();
  await page.getByRole('button', { name: 'Reset current count' }).click();
  await expect(page.locator('#reset-new-problem-session-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep current count' }).click();
  await expect(page.locator('#reset-new-problem-session-dialog')).toBeHidden();
  await expect(page.locator('#dashboard-settings-dialog')).toBeVisible();
  await expect(page.locator('[data-dashboard-new-problem-count]')).toHaveText('1');
  expect(resetRequests).toBe(0);

  await page.getByRole('button', { name: 'Reset current count' }).click();
  await page.getByRole('button', { name: 'Yes, reset count' }).click();
  await expect(page.locator('#reset-new-problem-session-dialog')).toBeHidden();
  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(page.locator('[data-dashboard-new-problem-count]')).toHaveText('0');
  await expect(page.locator('[data-dashboard-goal]')).toHaveText(' / 10');
  expect(resetRequests).toBe(1);
});

test('keeps reset confirmation open with unchanged count when persistence fails', async ({
  page,
}) => {
  await page.route('**/dashboard/settings', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Dashboard settings could not be saved.' }),
    }),
  );
  await page.goto('http://127.0.0.1:8791/dashboard/normal');
  await page.locator('#open-dashboard-settings').click();
  await page.getByRole('button', { name: 'Reset current count' }).click();
  await page.getByRole('button', { name: 'Yes, reset count' }).click();

  await expect(page.locator('#reset-new-problem-session-dialog')).toBeVisible();
  await expect(page.locator('#reset-new-problem-session-error')).toContainText(
    'Dashboard settings could not be saved.',
  );
  await expect(page.locator('[data-dashboard-new-problem-count]')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Yes, reset count' })).toBeEnabled();
});

test('supports Cancel and Escape with focus restoration', async ({ page }) => {
  await page.goto('http://127.0.0.1:8791/dashboard/empty');
  const opener = page.locator('#open-dashboard-settings');

  await opener.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keeps the dialog open and shows a live error after a failed save', async ({ page }) => {
  await page.route('**/dashboard/settings', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Dashboard settings could not be saved.' }),
    }),
  );
  await page.goto('http://127.0.0.1:8791/dashboard/stale');
  await page.locator('#open-dashboard-settings').click();
  await page.locator('#daily-new-problem-goal').fill('15');
  await page.getByRole('button', { name: 'Save maximum' }).click();

  await expect(page.locator('#dashboard-settings-dialog')).toBeVisible();
  await expect(page.locator('#dashboard-settings-error')).toContainText(
    'Dashboard settings could not be saved.',
  );
  await expect(page.getByRole('button', { name: 'Save maximum' })).toBeEnabled();
});

test('keeps Settings usable in every dashboard state and at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const state of ['normal', 'empty', 'stale', 'loading', 'unavailable']) {
    await page.goto(`http://127.0.0.1:8791/dashboard/${state}`);
    await expect(page.locator('#open-dashboard-settings')).toBeVisible();
  }
  await page.locator('#open-dashboard-settings').click();
  const bounds = await page.locator('#dashboard-settings-dialog').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Reset current count' }).click();
  const resetBounds = await page.locator('#reset-new-problem-session-dialog').boundingBox();
  expect(resetBounds).not.toBeNull();
  expect(resetBounds!.x).toBeGreaterThanOrEqual(0);
  expect(resetBounds!.x + resetBounds!.width).toBeLessThanOrEqual(375);
});
