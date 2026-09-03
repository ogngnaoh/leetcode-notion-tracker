import { expect, test, type Page } from '@playwright/test';
import {
  DirectExtensionFixture,
  TEST_NOTION_TOKEN,
  TEST_PASSPHRASE,
} from './direct-extension-fixture.js';
import { twoSum, secondProblem, type ProblemFixture } from './problem-fixtures.js';
import { directManifest } from '../../scripts/benchmark/direct-fixture.js';

let fixture: DirectExtensionFixture;
test.beforeEach(async () => {
  fixture = new DirectExtensionFixture();
  await fixture.launch();
});
test.afterEach(async () => {
  const errors = [...fixture.errors];
  await fixture.close();
  expect(errors).toEqual([]);
});

async function setup(
  problemFixture: ProblemFixture = twoSum,
  connect = true,
): Promise<{ problem: Page; panel: Page }> {
  const problem = await fixture.problem(problemFixture);
  const panel = await fixture.panel(problem);
  if (connect) {
    await fixture.connect(panel);
    await problem.bringToFront();
  }
  await panel.locator('#notion-log-tab').click();
  return { problem, panel };
}
async function choose(panel: Page, result = 'Solved'): Promise<void> {
  const button = panel.locator(`button[data-result="${result}"]`);
  await expect(button).toBeEnabled();
  await button.click();
}
async function setCode(problem: Page, code: string): Promise<void> {
  await problem.evaluate(
    (value) => (window as unknown as { __setModel(code: string): void }).__setModel(value),
    code,
  );
}
function codes(): string[] {
  const output: string[] = [];
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'code' && Array.isArray(value.code?.rich_text))
      output.push(value.code.rich_text.map((part: any) => part.text?.content ?? '').join(''));
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
  };
  for (const request of fixture.network) if (request.body) visit(JSON.parse(request.body));
  return output;
}
test('logs repeated daily reps without code, bridge settings, or Notion traffic and archives below goal', async () => {
  const problem = await fixture.problem({ ...twoSum, code: null });
  const panel = await fixture.panel(problem);

  await expect(panel.locator('#daily-reps-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('#daily-reps-panel')).toBeVisible();
  await expect(panel.locator('#notion-log-panel')).toBeHidden();
  await expect(panel.locator('#daily-problem-title')).toHaveText('Two Sum');
  await expect(panel.locator('#daily-problem-link')).toHaveCount(0);
  await expect(panel.locator('#daily-goal-editor')).toBeVisible();
  await expect(panel.locator('#log-daily-rep')).toBeDisabled();
  await expect(panel.locator('.current-reps')).toBeHidden();
  await expect(panel.locator('.daily-history-section')).toBeHidden();
  expect(fixture.network).toHaveLength(0);

  await panel.locator('#daily-goal-input').fill('3');
  await panel.locator('#save-daily-goal').click();
  await expect(panel.locator('#daily-goal-display')).toHaveText('3');
  await expect(panel.locator('#log-daily-rep')).toBeEnabled();
  await panel.locator('#log-daily-rep').click();
  await panel.locator('#log-daily-rep').click();

  await expect(panel.locator('#daily-rep-count')).toHaveText('2');
  await expect(panel.locator('#current-reps-list .rep-row')).toHaveCount(2);
  await expect(panel.locator('#current-reps-list .rep-title')).toHaveText([
    '#1 Two Sum',
    '#1 Two Sum',
  ]);
  await expect(panel.locator('.current-reps')).toBeVisible();
  await expect(panel.locator('#finish-daily-session')).toBeVisible();
  await panel.locator('#current-reps-list .remove-rep').first().click();
  await expect(panel.locator('#daily-rep-count')).toHaveText('1');
  await panel.locator('#log-daily-rep').click();
  await expect(panel.locator('#daily-rep-count')).toHaveText('2');
  expect(fixture.network).toHaveLength(0);

  await panel.locator('#finish-daily-session').click();
  await expect(panel.locator('#finish-session-message')).toContainText('2 of 3 reps, 1 short');
  await panel.locator('#confirm-finish-session').click();
  await expect(panel.locator('#daily-rep-count')).toHaveText('0');
  await expect(panel.locator('#daily-goal-display')).toHaveText('3');
  await expect(panel.locator('.current-reps')).toBeHidden();
  await expect(panel.locator('.daily-history-section')).toBeVisible();
  await expect(panel.locator('#daily-history .history-session')).toHaveCount(1);
  await expect(panel.locator('#daily-history .history-session')).toContainText('2/3');

  await panel.close();
  const reopened = await fixture.panel(problem);
  await expect(reopened.locator('#daily-goal-display')).toHaveText('3');
  await expect(reopened.locator('#daily-history .history-session')).toHaveCount(1);
  await reopened.locator('#daily-history .history-session summary').click();
  await expect(reopened.locator('#daily-history .rep-meta').first()).toContainText(
    'Easy · Array · Hash Table',
  );
  await reopened.locator('.delete-history-session').click();
  await expect(reopened.locator('#delete-session-dialog')).toBeVisible();
  await reopened.locator('#confirm-delete-session').click();
  await expect(reopened.locator('#daily-history .history-session')).toHaveCount(0);
  await expect(reopened.locator('.daily-history-section')).toBeHidden();
});

test('connects in sidebar with explicit preferences, returns to Log after the grant broadcast, and never writes during setup', async () => {
  const { problem, panel } = await setup(twoSum, false);
  await panel.locator('#log-connect').click();
  await panel.locator('#manifest-file').setInputFiles({
    name: 'notion-manifest.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(directManifest)),
  });
  await panel.locator('#preferences-file').setInputFiles({
    name: 'dashboard-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        dailyNewProblemGoal: 7,
        newProblemSessionStartedAt: '2026-09-01T04:00:00.000Z',
      }),
    ),
  });
  await expect(panel.locator('#import-preview')).toContainText('Imported goal: 7');
  await panel.locator('#notion-token').fill(TEST_NOTION_TOKEN);
  await panel.locator('#new-passphrase').fill(TEST_PASSPHRASE);
  await panel.locator('#confirm-passphrase').fill(TEST_PASSPHRASE);
  await panel.locator('#migration-confirm').check();
  await panel.locator('#connection-form button[type="submit"]').click();
  await expect(panel.locator('#notion-log-panel')).toBeVisible();
  await problem.bringToFront();
  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  expect(fixture.notion.counts.mutations).toBe(0);
  const state = await fixture.rpc(panel, { op: 'connection.state' });
  expect(state.preferences).toEqual({
    dailyNewProblemGoal: 7,
    newProblemSessionStartedAt: '2026-09-01T04:00:00.000Z',
  });
  await expect(panel.locator('#notion-token')).toHaveValue('');
});

test('only reads metadata on Daily and reads the full editor on unlocked Log', async () => {
  const { problem, panel } = await setup();
  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  await panel.locator('#daily-reps-tab').click();
  const mark = fixture.network.length;
  await setCode(problem, 'private changed code');
  await expect(panel.locator('#daily-problem-title')).toHaveText('Two Sum');
  expect(fixture.network).toHaveLength(mark);
  await panel.locator('#notion-log-tab').click();
  await expect(panel.locator('#captured-code')).toHaveText('private changed code');
  expect(fixture.notion.counts.mutations).toBe(0);
});

for (const variant of [
  { name: 'Monaco model', overrides: {} },
  { name: 'CodeMirror focus mode', overrides: { editor: 'codemirror' as const } },
  { name: 'late hydration', overrides: { lateModel: true } },
  {
    name: 'Accepted inactive description',
    overrides: { inactiveDescription: true, route: 'submissions/123/', animate: true },
  },
]) {
  test(`extracts complete ${variant.name} without focusing or scrolling the source`, async () => {
    const code = Array.from({ length: 75 }, (_, index) => `# full line ${index}`).join('\n');
    const { problem, panel } = await setup({
      ...twoSum,
      code,
      renderedLines: 4,
      ...variant.overrides,
    });
    await expect(panel.locator('#captured-code')).toHaveText(code);
    await expect(panel.locator('#problem-title')).toHaveText('Two Sum');
    await expect(panel.locator('#problem-topics')).toContainText('Array');
    expect(await problem.evaluate(() => scrollY)).toBe(0);
    expect(await problem.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await choose(panel);
    await expect(panel.locator('#success-confirmation')).toContainText('Saved to Notion');
    expect(codes()).toContain(code);
  });
}

for (const outcome of ['Needed help', 'Solved']) {
  test(`${outcome} saves one confirmed event and preserves the stable Attempt on repetition`, async () => {
    const { panel } = await setup();
    await choose(panel, outcome);
    await expect(panel.locator('#success-confirmation')).toContainText('Saved to Notion');
    const first = (await fixture.rpc(panel, { op: 'capture.pending' })).completed!;
    await expect(panel.locator('#review-state')).toContainText(
      `Solved streak ${first.result.review.solvedStreak}`,
    );
    await choose(panel, outcome);
    await expect
      .poll(async () => (await fixture.rpc(panel, { op: 'capture.pending' })).completed?.eventId)
      .not.toBe(first.eventId);
    const second = (await fixture.rpc(panel, { op: 'capture.pending' })).completed!;
    expect(second.result.attemptPageId).toBe(first.result.attemptPageId);
    expect(second.result.review.practiceState).toBe(outcome);
  });
}

test('Lock clears code and Review across open panels; unlock returns to the chosen view', async () => {
  const { problem, panel } = await setup();
  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  const second = await fixture.panel(problem);
  await second.locator('#notion-log-tab').click();
  await expect(second.locator('#captured-code')).toHaveText(twoSum.code!);
  await panel.locator('#open-settings').click();
  await panel.locator('#lock-notion').click();
  await expect(panel.locator('#unlock-form')).toBeVisible();
  await expect(second.locator('#captured-code')).toHaveText('');
  await expect(second.locator('#log-private')).toBeHidden();
  await setCode(problem, 'never repopulate while locked');
  await expect(second.locator('#captured-code')).toHaveText('');
  await panel.locator('#unlock-passphrase').fill(TEST_PASSPHRASE);
  await panel.locator('#unlock-form button[type="submit"]').click();
  await expect(panel.locator('#notion-log-panel')).toBeVisible();
  await expect(panel.locator('#captured-code')).toHaveText('never repopulate while locked');
});

test('uncertain save remains globally frozen across source navigation and checking never creates another page', async () => {
  const { problem, panel } = await setup();
  let lose = true;
  fixture.notion.afterRequest = (request) => {
    if (lose && request.method === 'POST' && request.path === '/v1/pages') {
      lose = false;
      throw new Error('simulated lost response');
    }
  };
  await choose(panel);
  await expect(panel.locator('#retry-attempt')).toHaveText('Check saved result');
  const pending = (await fixture.rpc(panel, { op: 'capture.pending' })).pending!;
  const other = await fixture.problem(secondProblem);
  await other.bringToFront();
  await expect(panel.locator('#problem-title')).toHaveText(secondProblem.title);
  await expect(panel.locator('#pending-detail')).toContainText('Two Sum');
  await expect(panel.locator('button[data-result="Solved"]')).toBeDisabled();
  const creates = fixture.network.filter(
    (r) => r.method === 'POST' && new URL(r.url).pathname === '/v1/pages',
  ).length;
  await panel.locator('#retry-attempt').click();
  await expect
    .poll(async () => (await fixture.rpc(panel, { op: 'capture.pending' })).pending?.disposition)
    .toBe('retry');
  expect(
    fixture.network.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/v1/pages'),
  ).toHaveLength(creates);
  const retained = (await fixture.rpc(panel, { op: 'capture.pending' })).pending!;
  expect(retained.event).toEqual(pending.event);
  await panel.locator('#retry-attempt').click();
  await expect
    .poll(async () => (await fixture.rpc(panel, { op: 'capture.pending' })).connection.hasPending)
    .toBe(false);
  expect((await fixture.rpc(panel, { op: 'capture.pending' })).completed?.eventId).toBe(
    pending.event.clientEventId,
  );
  await problem.close();
});

test('Review loads without an external dashboard, filters locally and resets only its own preferences', async () => {
  const { panel } = await setup();
  await choose(panel, 'Needed help');
  await expect(panel.locator('#success-confirmation')).toContainText('Saved to Notion');
  await panel.locator('#review-tab').click();
  await expect(panel.locator('#review-updated')).toContainText('Updated');
  const mark = fixture.network.length;
  await panel.locator('#review-search').fill('no such problem');
  await panel.locator('#review-filter').selectOption('needed-help');
  await expect(panel.locator('#review-list li')).toHaveCount(0);
  expect(fixture.network).toHaveLength(mark);
  await panel.locator('#edit-review-goal').click();
  await panel.locator('#review-goal').fill('6');
  await panel.locator('#review-goal-form button[type="submit"]').click();
  await expect(panel.locator('#review-goal-value')).toHaveText('6');
  const mutations = fixture.notion.counts.mutations;
  await panel.locator('#reset-review').click();
  await expect(panel.locator('#notion-confirm-dialog')).toBeVisible();
  await panel.locator('#notion-confirm-cancel').click();
  expect(
    (await fixture.rpc(panel, { op: 'connection.state' })).preferences?.newProblemSessionStartedAt,
  ).toBeUndefined();
  await panel.locator('#reset-review').click();
  await panel.locator('#notion-confirm-accept').click();
  await expect
    .poll(
      async () =>
        (await fixture.rpc(panel, { op: 'connection.state' })).preferences
          ?.newProblemSessionStartedAt,
    )
    .toBeTruthy();
  expect(fixture.notion.counts.mutations).toBe(mutations);
});

for (const width of [320, 360, 400, 480]) {
  test(`sidebar remains usable at ${width}px with keyboard tabs, expanded code and Settings`, async () => {
    const { panel } = await setup({
      ...secondProblem,
      code: 'const longLine = "' + 'x'.repeat(500) + '";',
    });
    await panel.setViewportSize({ width, height: 480 });
    await expect(panel.locator('#captured-code')).toContainText('const longLine');
    await panel.locator('#expand-code').click();
    await expect(panel.locator('#expand-code')).toHaveAttribute('aria-expanded', 'true');
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.locator('#notion-log-tab').focus();
    await panel.keyboard.press('ArrowRight');
    await expect(panel.locator('#review-tab')).toHaveAttribute('aria-selected', 'true');
    await panel.locator('#open-settings').click();
    await expect(panel.locator('#settings-panel')).toBeVisible();
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.locator('#settings-back').click();
    await expect(panel.locator('#review-panel')).toBeVisible();
  });
}

test('blank and missing models never admit a Notion save', async () => {
  const { panel } = await setup({ ...twoSum, code: null });
  await expect(panel.locator('button[data-result="Solved"]')).toBeDisabled();
  expect(fixture.notion.counts.mutations).toBe(0);
});

test('options is a token-free entry into sidebar settings', async () => {
  const page = await fixture.context.newPage();
  await page.goto(`chrome-extension://${fixture.extensionId}/options.html`);
  await expect(page.locator('input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open LCTrack Settings' })).toBeVisible();
});

test('a click-time code change requires a new confirmation and rapid repeated clicks create one event', async () => {
  const { problem, panel } = await setup();
  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  await expect(panel.locator('button[data-result="Solved"]')).toBeEnabled();
  // Simulate a model update before its change notification reaches the extension.
  await problem.evaluate(() => {
    const editor = (window as any).monaco.editor.getEditors()[0];
    editor.getModel().getValue = () => 'const clickTimeCode = 42;';
  });
  await choose(panel);
  await expect(panel.locator('#status')).toContainText('The code changed');
  await expect(panel.locator('#captured-code')).toHaveText('const clickTimeCode = 42;');
  expect(fixture.notion.counts.mutations).toBe(0);
  await panel.locator('button[data-result="Solved"]').evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(panel.locator('#success-confirmation')).toContainText('Saved to Notion');
  expect(
    fixture.network.filter(
      (request) => request.method === 'POST' && new URL(request.url).pathname === '/v1/pages',
    ),
  ).toHaveLength(2);
  expect(codes()).toContain('const clickTimeCode = 42;');
});

test('SPA navigation replaces metadata and code without binding a new save to the old problem', async () => {
  const { problem, panel } = await setup();
  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  await problem.evaluate((next) => {
    history.pushState({}, '', `/problems/${next.slug}/`);
    document.title = `${next.number}. ${next.title} - LeetCode`;
    const link = document.querySelector<HTMLAnchorElement>('[data-testid="question-title"] a')!;
    link.href = `/problems/${next.slug}/`;
    link.textContent = `${next.number}. ${next.title}`;
    document.querySelector('[data-testid="difficulty"]')!.textContent = next.difficulty;
    (window as any).__setModel(next.code, next.language);
  }, secondProblem);
  await expect(panel.locator('#problem-title')).toHaveText(secondProblem.title);
  await expect(panel.locator('#captured-code')).toHaveText(secondProblem.code!);
  await choose(panel);
  await expect(panel.locator('#success-confirmation')).toContainText('Saved to Notion');
  const completed = (await fixture.rpc(panel, { op: 'capture.pending' })).completed!;
  expect(completed.result.problemPageId).toBeTruthy();
  const creates = fixture.network.filter(
    (request) => request.method === 'POST' && new URL(request.url).pathname === '/v1/pages',
  );
  expect(JSON.stringify(creates)).toContain(secondProblem.slug);
  expect(JSON.stringify(creates)).not.toContain(twoSum.slug);
});

test('a damaged encrypted connection offers a guarded reset and requires reconciliation afterwards', async () => {
  const problem = await fixture.problem(twoSum);
  const panel = await fixture.panel(problem);
  await panel.evaluate(async () => {
    await chrome.storage.local.set({ 'lctrack.notion.vault.v1': { version: 'damaged' } });
  });
  await fixture.stopWorker();
  await panel.reload();
  await panel.locator('#open-settings').click();
  await expect(panel.locator('#disconnect-notion')).toHaveText('Reset saved connection');
  await panel.locator('#disconnect-notion').click();
  await expect(panel.locator('#notion-confirm-message')).toContainText(
    'may already exist in Notion',
  );
  await panel.locator('#notion-confirm-cancel').click();
  expect(
    await panel.evaluate(
      async () =>
        (await chrome.storage.local.get('lctrack.notion.vault.v1'))['lctrack.notion.vault.v1'],
    ),
  ).toBeTruthy();
  await panel.locator('#disconnect-notion').click();
  await panel.locator('#notion-confirm-accept').click();
  await expect(panel.locator('#connection-form')).toBeVisible();
  await expect(panel.locator('#manual-reconciliation')).toBeVisible();
  expect(fixture.network).toHaveLength(0);
});

test('renders the approved Log and Review layouts with real synthetic tracker data', async () => {
  const { problem, panel } = await setup({
    ...twoSum,
    code: 'def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []',
  });
  await panel.setViewportSize({ width: 466, height: 960 });
  await expect(panel.locator('button[data-result="Solved"]')).toBeEnabled();
  await expect(panel.locator('#status')).toHaveText('');
  await panel.screenshot({
    path: '/tmp/lctrack-approved-log.png',
    fullPage: true,
    animations: 'disabled',
  });
  const { captureEvent } = await import('../../scripts/benchmark/fixture.js');
  const sourceId = await panel.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
    problem.url(),
  );
  for (const [index, title] of [
    'Two Sum',
    'Longest Substring Without Repeating Characters',
    'Valid Parentheses',
    'Merge Intervals',
  ].entries()) {
    const event = captureEvent(index + 70);
    const slug = title.toLowerCase().replaceAll(' ', '-');
    event.problem = {
      ...event.problem,
      title,
      slug,
      number: index + 1,
      url: `https://leetcode.com/problems/${slug}/`,
      difficulty: index % 2 ? 'Medium' : 'Easy',
    };
    event.attempt = {
      ...event.attempt,
      result: 'Needed help',
      attemptedAt: '2026-08-01T12:00:00.000Z',
      attemptedOn: '2026-08-01',
    };
    await fixture.rpc(panel, {
      op: 'capture.submit',
      event,
      source: { tabId: sourceId, fingerprint: `synthetic-visual-${index}` },
    });
  }
  await panel.locator('#review-tab').click();
  await expect(panel.locator('#review-list li')).toHaveCount(4);
  await panel.screenshot({
    path: '/tmp/lctrack-approved-review.png',
    fullPage: true,
    animations: 'disabled',
  });
  await panel.locator('#open-settings').click();
  await panel.screenshot({
    path: '/tmp/lctrack-approved-settings.png',
    fullPage: true,
    animations: 'disabled',
  });
});

for (const editor of ['monaco', 'codemirror'] as const) {
  test(`Daily and locked views never poll full ${editor} model text`, async () => {
    const problem = await fixture.problem({ ...twoSum, editor });
    const panel = await fixture.panel(problem);
    const reads = await problem.evaluate(async (editor) => {
      let reads = 0;
      if (editor === 'monaco') {
        const model = (window as any).monaco.editor.getEditors()[0].getModel();
        const original = model.getValue;
        model.getValue = () => {
          reads++;
          return original();
        };
      } else {
        const doc = (document.querySelector('.cm-content') as any).cmView.view.state.doc;
        const original = doc.toString;
        doc.toString = () => {
          reads++;
          return original();
        };
      }
      (window as any).__fullTextReads = () => reads;
      await new Promise((resolve) => setTimeout(resolve, 850));
      return reads;
    }, editor);
    expect(reads).toBe(0);
    await panel.locator('#notion-log-tab').click();
    await expect(panel.locator('#log-private')).toBeHidden();
    expect(
      await problem.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 850));
        return (window as any).__fullTextReads();
      }),
    ).toBe(0);
    expect(fixture.network).toHaveLength(0);
  });
}
