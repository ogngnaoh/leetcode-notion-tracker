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
  const labelBox = await page.getByText('New problems per day', { exact: true }).boundingBox();
  const inputBox = await page.locator('#daily-new-problem-goal').boundingBox();
  expect(labelBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y - (labelBox!.y + labelBox!.height)).toBeGreaterThanOrEqual(10);
  await page.locator('#daily-new-problem-goal').fill('14');
  await page.getByRole('button', { name: 'Save goal' }).click();

  await expect(page.locator('#dashboard-settings-dialog')).toBeHidden();
  await expect(page.locator('[data-dashboard-goal]')).toHaveText(' / 14');
  await expect(opener).toBeFocused();
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
  await page.getByRole('button', { name: 'Save goal' }).click();

  await expect(page.locator('#dashboard-settings-dialog')).toBeVisible();
  await expect(page.locator('#dashboard-settings-error')).toContainText(
    'Dashboard settings could not be saved.',
  );
  await expect(page.getByRole('button', { name: 'Save goal' })).toBeEnabled();
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
});
