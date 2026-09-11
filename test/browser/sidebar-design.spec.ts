import { expect, test } from '@playwright/test';
import { DirectExtensionFixture } from './direct-extension-fixture.js';
import { secondProblem } from './problem-fixtures.js';

test('Log and Settings share the Daily Reps action hierarchy at narrow and wide widths', async () => {
  const fixture = new DirectExtensionFixture();
  await fixture.launch();
  try {
    const problem = await fixture.problem(secondProblem);
    const panel = await fixture.panel(problem);
    const consoleErrors: string[] = [];
    panel.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await expect(panel).toHaveTitle('LCTrack');
    expect(panel.url()).toContain(`chrome-extension://${fixture.extensionId}/sidepanel.html`);
    await panel.locator('#notion-log-tab').click();
    await expect(panel.locator('#log-connect')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await panel.locator('#log-connect').click();
    await expect(panel.locator('#connection-form button[type="submit"]')).toHaveCSS(
      'background-color',
      'rgb(0, 0, 0)',
    );
    await fixture.connect(panel);
    await problem.bringToFront();
    await panel.locator('#notion-log-tab').click();
    await expect(panel.locator('#captured-code')).toHaveText(secondProblem.code!);
    for (const width of [340, 460]) {
      await panel.setViewportSize({ width, height: 800 });
      const solved = panel.locator('[data-result="Solved"]');
      await expect(solved).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(solved).toHaveCSS('border-radius', '0px');
      await solved.hover();
      await expect(solved).toHaveCSS('background-color', 'rgb(0, 71, 171)');
      await panel.locator('#problem-title').hover();
      await expect(solved).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(panel.locator('.problem-panel')).toHaveCSS('border-top-width', '1px');
      await expect(panel.locator('.problem-panel')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)',
      );
      await expect(panel.locator('#problem-difficulty')).toHaveCSS('border-top-width', '1px');
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await panel.screenshot({ path: `/tmp/lctrack-log-${width}.png`, fullPage: true });
      await panel.locator('#code-disclosure summary').click();
      await expect(panel.locator('#captured-code')).toBeHidden();
      await panel.locator('#code-disclosure summary').click();
      await expect(panel.locator('#captured-code')).toBeVisible();
      await panel.locator('#open-settings').click();
      await expect(panel.locator('#lock-notion')).toHaveCSS('border-top-color', 'rgb(0, 0, 0)');
      await panel.screenshot({ path: `/tmp/lctrack-settings-${width}.png`, fullPage: true });
      await panel.locator('#settings-back').click();
    }
    await panel.locator('#open-settings').click();
    await panel.locator('#lock-notion').click();
    await expect(panel.locator('#unlock-form')).toBeVisible();
    await expect(panel.locator('#unlock-form button[type="submit"]')).toHaveCSS(
      'background-color',
      'rgb(0, 0, 0)',
    );
    expect(consoleErrors).toEqual([]);
    expect(fixture.errors).toEqual([]);
    expect(fixture.notion.counts.mutations).toBe(0);
  } finally {
    await fixture.close();
  }
});
