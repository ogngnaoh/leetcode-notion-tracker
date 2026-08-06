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

test('saves the inline maximum with Enter and restores focus to the updated button', async ({
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

  const goalButton = page.locator('[data-dashboard-goal]');
  const goalInput = page.locator('#daily-new-problem-goal');
  await expect(goalButton).toHaveAccessibleName('Maximum new problems: 10. Activate to edit.');
  await goalButton.click();
  await expect(goalButton).toBeHidden();
  await expect(goalInput).toBeVisible();
  await expect(goalInput).toBeFocused();
  await expect(goalInput).toHaveValue('10');

  await goalInput.fill('14');
  await goalInput.press('Enter');

  await expect(goalInput).toBeHidden();
  await expect(goalButton).toHaveText('14');
  await expect(goalButton).toHaveAccessibleName('Maximum new problems: 14. Activate to edit.');
  await expect(goalButton).toBeFocused();
});

test('saves on blur without stealing focus and disables the input during persistence', async ({
  page,
}) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/dashboard/settings', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ dailyNewProblemGoal: 15 });
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dailyNewProblemGoal: 15 }),
    });
  });
  await page.goto('http://127.0.0.1:8791/dashboard/normal');

  const goalButton = page.locator('[data-dashboard-goal]');
  const goalInput = page.locator('#daily-new-problem-goal');
  const refresh = page.getByRole('link', { name: /Refresh/ });
  await goalButton.click();
  await goalInput.fill('15');
  await refresh.focus();

  await expect(goalInput).toBeDisabled();
  await expect(refresh).toBeFocused();
  releaseResponse();
  await expect(goalInput).toBeHidden();
  await expect(goalButton).toHaveText('15');
  await expect(refresh).toBeFocused();
});

test('cancels with Escape and exits unchanged edits without a request', async ({ page }) => {
  let settingsRequests = 0;
  await page.route('**/dashboard/settings', async (route) => {
    settingsRequests += 1;
    await route.abort();
  });
  await page.goto('http://127.0.0.1:8791/dashboard/empty');

  const goalButton = page.locator('[data-dashboard-goal]');
  const goalInput = page.locator('#daily-new-problem-goal');
  const refresh = page.getByRole('link', { name: /Refresh/ });
  await goalButton.click();
  await goalInput.fill('23');
  await goalInput.press('Escape');
  await expect(goalInput).toBeHidden();
  await expect(goalInput).toHaveValue('10');
  await expect(goalButton).toHaveText('10');
  await expect(goalButton).toBeFocused();

  await goalButton.click();
  await goalInput.press('Enter');
  await expect(goalInput).toBeHidden();
  await expect(goalButton).toBeFocused();

  await goalButton.click();
  await refresh.focus();
  await expect(goalInput).toBeHidden();
  await expect(refresh).toBeFocused();
  expect(settingsRequests).toBe(0);
});

test('keeps invalid inline maximums editing with a live error and no request', async ({ page }) => {
  let settingsRequests = 0;
  await page.route('**/dashboard/settings', async (route) => {
    settingsRequests += 1;
    await route.abort();
  });
  await page.goto('http://127.0.0.1:8791/dashboard/unavailable');

  const goalButton = page.locator('[data-dashboard-goal]');
  const goalInput = page.locator('#daily-new-problem-goal');
  const goalError = page.locator('#daily-new-problem-goal-error');
  for (const value of ['0', '101', '1.5']) {
    await goalButton.click();
    await goalInput.fill(value);
    await goalInput.press('Enter');
    await expect(goalInput).toBeVisible();
    await expect(goalInput).toBeEnabled();
    await expect(goalInput).toHaveAttribute('aria-invalid', 'true');
    await expect(goalError).toContainText('Enter an integer from 1–100.');
    await expect(goalError).toHaveAttribute('aria-live', 'polite');
    await goalInput.press('Escape');
  }
  expect(settingsRequests).toBe(0);
});

test('keeps the inline editor open with the bridge error after a failed save', async ({ page }) => {
  await page.route('**/dashboard/settings', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Dashboard settings could not be saved.' }),
    }),
  );
  await page.goto('http://127.0.0.1:8791/dashboard/stale');
  const goalButton = page.locator('[data-dashboard-goal]');
  const goalInput = page.locator('#daily-new-problem-goal');
  await goalButton.click();
  await goalInput.fill('15');
  await goalInput.press('Enter');

  await expect(goalInput).toBeVisible();
  await expect(goalInput).toBeEnabled();
  await expect(page.locator('#daily-new-problem-goal-error')).toContainText(
    'Dashboard settings could not be saved.',
  );
  await expect(goalButton).toHaveText('10');
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
        dailyNewProblemGoal: 17,
        newProblemCount: 0,
        newProblemSessionStartedAt: '2026-07-22T15:00:00.000Z',
      }),
    });
  });
  await page.goto('http://127.0.0.1:8791/dashboard/normal');

  await page.locator('#open-dashboard-settings').click();
  await expect(page.locator('#dashboard-settings-dialog')).not.toContainText(
    'Maximum new problems',
  );
  await expect(page.locator('#dashboard-settings-dialog')).not.toContainText('Save maximum');
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
  await expect(page.locator('[data-dashboard-goal]')).toHaveText('17');
  await expect(page.locator('[data-dashboard-goal]')).toHaveAccessibleName(
    'Maximum new problems: 17. Activate to edit.',
  );
  await expect(page.locator('#daily-new-problem-goal')).toHaveValue('17');
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

test('supports Close and Escape in reset-only Settings with focus restoration', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8791/dashboard/empty');
  const opener = page.locator('#open-dashboard-settings');

  await opener.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keeps the inline editor and Settings usable in every state and at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const state of ['normal', 'empty', 'stale', 'loading', 'unavailable']) {
    await page.goto(`http://127.0.0.1:8791/dashboard/${state}`);
    const summaryBefore = await page.locator('.summary--solves').boundingBox();
    await page.locator('[data-dashboard-goal]').click();
    await expect(page.locator('#daily-new-problem-goal')).toBeVisible();
    const summaryDuring = await page.locator('.summary--solves').boundingBox();
    expect(summaryBefore).not.toBeNull();
    expect(summaryDuring).not.toBeNull();
    expect(summaryDuring!.height).toBe(summaryBefore!.height);
    await page.locator('#daily-new-problem-goal').fill('101');
    await page.locator('#daily-new-problem-goal').press('Enter');
    await expect(page.locator('#daily-new-problem-goal-error')).toHaveText(
      'Enter an integer from 1–100.',
    );
    const summaryWithError = await page.locator('.summary--solves').boundingBox();
    expect(summaryWithError).not.toBeNull();
    expect(summaryWithError!.height).toBe(summaryBefore!.height);
    await page.locator('#daily-new-problem-goal').press('Escape');
    await expect(page.locator('#open-dashboard-settings')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
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
