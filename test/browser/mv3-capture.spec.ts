import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MockBridge, TEST_BRIDGE_TOKEN, type BridgeReply } from './mock-bridge.js';

test.describe.configure({ mode: 'serial' });

interface ProblemFixture {
  slug: string;
  title: string;
  number: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
  /** Monaco language id, which on LeetCode is the site's own slug. */
  language: string;
  code: string | null;
  /** How many logical lines the fake view renders. Omit to render all of them. */
  renderedLines?: number;
  /** Installs `window.monaco` well after the model request timeout, mimicking slow hydration. */
  lateModel?: boolean;
}

const twoSum: ProblemFixture = {
  slug: 'two-sum',
  title: 'Two Sum',
  number: 1,
  difficulty: 'Easy',
  topics: ['Array', 'Hash Table', 'Array'],
  language: 'python3',
  code: 'def twoSum(nums, target):\n    seen = {}\n    return []',
};

const secondProblem: ProblemFixture = {
  slug: 'longest-substring-without-repeating-characters',
  title: 'Longest Substring Without Repeating Characters',
  number: 3,
  difficulty: 'Medium',
  topics: ['Hash Table', 'String', 'Sliding Window'],
  language: 'typescript',
  code: 'function lengthOfLongestSubstring(s: string): number {\n  return s.length;\n}',
};

const bridge = new MockBridge();
const extensionPath = resolve('dist/extension');
let context: BrowserContext;
let userDataDir: string;
let extensionId: string;

function fixtureHtml(fixture: ProblemFixture): string {
  const topics = fixture.topics
    .map((topic) => {
      const slug = topic.toLowerCase().replaceAll(' ', '-');
      return `<a class="topic" href="/tag/${slug}/">${topic}</a>`;
    })
    .join('');
  const editor =
    fixture.code === null
      ? ''
      : `<div class="editor"><div class="monaco-editor"><div class="view-lines"></div></div></div>
    <script>
      (() => {
        const contentListeners = new Set();
        const languageListeners = new Set();
        const state = {
          code: ${JSON.stringify(fixture.code)},
          languageId: ${JSON.stringify(fixture.language)},
          rendered: ${fixture.renderedLines ?? -1},
        };
        const node = document.querySelector('.monaco-editor');
        const view = node.querySelector('.view-lines');
        const render = () => {
          const lines = state.code.split('\\n');
          const shown = state.rendered < 0 ? lines : lines.slice(0, state.rendered);
          view.replaceChildren(...shown.map((text) => {
            const line = document.createElement('div');
            line.className = 'view-line';
            line.textContent = text;
            return line;
          }));
        };
        const model = {
          getValue: () => state.code,
          getLineCount: () => state.code.split('\\n').length,
          getLanguageId: () => state.languageId,
          onDidChangeContent: (listener) => {
            contentListeners.add(listener);
            return { dispose: () => contentListeners.delete(listener) };
          },
        };
        const editorInstance = {
          getModel: () => model,
          getDomNode: () => node,
          onDidChangeModelLanguage: (listener) => {
            languageListeners.add(listener);
            return { dispose: () => languageListeners.delete(listener) };
          },
        };
        const install = () => {
          window.monaco = { editor: { getEditors: () => [editorInstance] } };
        };
        if (${fixture.lateModel === true}) setTimeout(install, 900); else install();
        window.__setModel = (code, languageId, rendered) => {
          state.code = code;
          if (languageId !== undefined) state.languageId = languageId;
          if (rendered !== undefined) state.rendered = rendered;
          render();
          for (const listener of contentListeners) listener();
          for (const listener of languageListeners) listener();
        };
        render();
      })();
    </script>`;
  return `<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><title>${fixture.number}. ${fixture.title} - LeetCode</title>
    <style>
      body { font-family: sans-serif; }
      [data-testid="question-title"], [data-testid="difficulty"], .topic, .editor { display: block; width: 480px; min-height: 24px; }
      .monaco-editor { position: relative; width: 480px; height: 240px; }
      .view-line { min-height: 20px; white-space: pre; }
      #topics { margin-top: 1600px; }
    </style></head><body>
      <h1 data-testid="question-title">${fixture.number}. ${fixture.title}</h1>
      <div data-testid="difficulty">${fixture.difficulty}</div>
      ${editor}<section id="topics">${topics}</section>
    </body></html>`;
}

async function launchExtension(): Promise<void> {
  userDataDir = await mkdtemp(join(tmpdir(), 'leetcode-tracker-playwright-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => null));
  if (!serviceWorker) {
    throw new Error(
      'The built MV3 extension service worker did not appear. Run npm run build:extension and ensure Playwright bundled Chromium is installed.',
    );
  }
  extensionId = new URL(serviceWorker.url()).host;
  if (!extensionId) throw new Error(`Could not derive extension ID from ${serviceWorker.url()}.`);
}

async function closeCasePages(): Promise<void> {
  await Promise.all(context.pages().map((page) => page.close().catch(() => undefined)));
}

async function setStorage(token: string | null): Promise<void> {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('MV3 service worker is unavailable.');
  await worker.evaluate(
    async ({ tokenValue, bridgeUrl }) => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      if (tokenValue !== null) {
        await chrome.storage.local.set({
          trackerSettings: { bridgeUrl, bridgeToken: tokenValue },
        });
      }
    },
    { tokenValue: token, bridgeUrl: 'http://127.0.0.1:8787' },
  );
}

async function readSessionForPage(page: Page): Promise<unknown> {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('MV3 service worker is unavailable.');
  return worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    const tabId = tabs[0]?.id;
    if (tabId === undefined) return null;
    const key = `leetcodeTracker.capture.tab.${tabId}`;
    return (await chrome.storage.session.get(key))[key] ?? null;
  }, page.url());
}

async function activeChromeTabUrl(): Promise<string | undefined> {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('MV3 service worker is unavailable.');
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url;
  });
}

async function openProblem(fixture: ProblemFixture): Promise<Page> {
  const page = await context.newPage();
  await page.route('https://leetcode.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest() && url.pathname === `/problems/${fixture.slug}/`) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml(fixture) });
      return;
    }
    await route.abort('blockedbyclient');
  });
  await page.goto(`https://leetcode.com/problems/${fixture.slug}/`);
  if (fixture.code === null) {
    await expect(page.locator('.monaco-editor')).toHaveCount(0);
  } else {
    await expect(page.locator('.view-lines > .view-line').first()).toBeAttached();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  }
  return page;
}

async function openPanel(activeProblem: Page): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await activeProblem.bringToFront();
  await expect(panel.locator('#problem-title')).not.toHaveText('OPEN A LEETCODE PROBLEM');
  return panel;
}

async function setupCase(
  fixture: ProblemFixture = twoSum,
  token: string | null = TEST_BRIDGE_TOKEN,
  configureBridge: (() => void) | null = null,
): Promise<{ problem: Page; panel: Page }> {
  await closeCasePages();
  bridge.reset();
  configureBridge?.();
  await setStorage(token);
  const problem = await openProblem(fixture);
  const panel = await openPanel(problem);
  return { problem, panel };
}

async function choose(panel: Page, result: string): Promise<void> {
  const button = panel.locator(`button[data-result=${JSON.stringify(result)}]`);
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

async function retry(panel: Page): Promise<void> {
  const button = panel.locator('#retry-attempt');
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}

async function expectSoleRetry(panel: Page, disabled = false): Promise<void> {
  await expect(panel.locator('#outcome-actions')).toBeHidden();
  await expect(panel.locator('#success-confirmation')).toBeHidden();
  await expect(panel.locator('#retry-attempt')).toBeVisible();
  if (disabled) {
    await expect(panel.locator('#retry-attempt')).toBeDisabled();
  } else {
    await expect(panel.locator('#retry-attempt')).toBeEnabled();
  }
}

async function expectOnlyStatusPathSince(requestMark: number, expectedPath: string): Promise<void> {
  await expect
    .poll(() => {
      const paths = bridge.requests
        .slice(requestMark)
        .filter((request) => request.method === 'GET')
        .map((request) => request.path);
      return paths.length > 0 && paths.every((path) => path === expectedPath);
    })
    .toBe(true);
}

async function replaceProblem(page: Page, fixture: ProblemFixture): Promise<void> {
  await page.evaluate(
    ({ next }) => {
      history.pushState({}, '', `/problems/${next.slug}/`);
      document.title = `${next.number}. ${next.title} - LeetCode`;
      const title = document.querySelector('[data-testid="question-title"]');
      const difficulty = document.querySelector('[data-testid="difficulty"]');
      const topics = document.querySelector('#topics');
      if (title) title.textContent = `${next.number}. ${next.title}`;
      if (difficulty) difficulty.textContent = next.difficulty;
      if (topics) {
        topics.replaceChildren(
          ...next.topics.map((topic) => {
            const anchor = document.createElement('a');
            anchor.className = 'topic';
            anchor.href = `/tag/${topic.toLowerCase().replaceAll(' ', '-')}/`;
            anchor.textContent = topic;
            return anchor;
          }),
        );
      }
      if (next.code !== null) {
        (
          window as unknown as { __setModel: (code: string, languageId?: string) => void }
        ).__setModel(next.code, next.language);
      }
    },
    { next: fixture },
  );
}

async function setCode(page: Page, code: string, _publish: boolean): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { __setModel: (code: string) => void }).__setModel(value);
  }, code);
}

function successReply(duplicate = false): BridgeReply {
  return {
    kind: 'response',
    status: 200,
    body: {
      duplicate,
      problemPageId: 'problem-page',
      attemptPageId: 'attempt-page',
      review: { practiceState: 'Solved', solvedStreak: 1, nextReview: '2026-07-21' },
    },
  };
}

test.beforeAll(async () => {
  await bridge.start();
  try {
    await launchExtension();
  } catch (error) {
    await bridge.stop();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
    throw error;
  }
});

test.afterEach(async () => {
  bridge.reset();
  await closeCasePages();
});

test.afterAll(async () => {
  await context?.close().catch(() => undefined);
  await bridge.stop();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test('extracts and renders visible public-DOM problem, topics, language, and exact code', async () => {
  const { panel } = await setupCase(twoSum, TEST_BRIDGE_TOKEN, () => {
    bridge.statusReply = {
      kind: 'response',
      status: 200,
      body: {
        found: true,
        practiceState: 'Solved',
        solvedStreak: 2,
        nextReview: '2999-07-24',
        lastAttempt: '2026-07-20T12:30:00.000Z',
      },
    };
  });

  await expect(panel.locator('#problem-title')).toHaveText('Two Sum');
  await expect(panel.locator('.tracker-title')).toHaveText('LC TRACK');
  expect(
    await panel
      .locator('.tracker-title img')
      .evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(panel.locator('#problem-number')).toHaveText('#1');
  await expect(panel.locator('#problem-difficulty')).toHaveText('Easy');
  await expect(panel.locator('#problem-topics li')).toHaveText(['Array', 'Hash Table']);
  await expect(panel.locator('#code-language')).toHaveText('Python');
  await expect(panel.locator('#code-line-count')).toHaveText('3 lines');
  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  await expect(panel.locator('#code-disclosure')).toHaveAttribute('open', '');
  await expect(panel.locator('#review-state')).toHaveText('Review on 2999-07-24');
  await expect(panel.locator('#outcome-actions button')).toHaveText(['Needed help', 'Solved']);
  const verticalOrder = await panel
    .locator('.problem-panel, .capture-section, #code-disclosure')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(verticalOrder).toEqual([...verticalOrder].sort((left, right) => left - right));
  const outcomeWidths = await panel
    .locator('#outcome-actions button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  expect(new Set(outcomeWidths).size).toBe(1);
  expect(bridge.posts()).toHaveLength(0);
});

test('focuses an existing dashboard tab and recreates it after closure', async () => {
  const { problem, panel } = await setupCase();
  const dashboard = await context.newPage();
  await dashboard.goto('http://127.0.0.1:8787/dashboard');
  await expect(dashboard).toHaveTitle('LC Log Daily');
  await problem.bringToFront();

  await panel.locator('#open-dashboard').click();
  await expect.poll(activeChromeTabUrl).toBe('http://127.0.0.1:8787/dashboard');
  expect(context.pages().filter((page) => page.url().endsWith('/dashboard'))).toHaveLength(1);

  await dashboard.close();
  await problem.bringToFront();
  await panel.locator('#open-dashboard').click();
  await expect
    .poll(() => context.pages().filter((page) => page.url().endsWith('/dashboard')).length)
    .toBe(1);
  await expect.poll(activeChromeTabUrl).toBe('http://127.0.0.1:8787/dashboard');
});

test('shows an actionable shortcut error for an invalid Bridge URL', async () => {
  const { panel } = await setupCase();
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('MV3 service worker is unavailable.');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      trackerSettings: { bridgeUrl: 'not a URL', bridgeToken: 'irrelevant-token-value' },
    });
  });

  await panel.locator('#open-dashboard').click();

  await expect(panel.locator('#status')).toContainText('valid HTTP or HTTPS Bridge URL');
  await expect(panel.locator('#open-options')).toHaveAttribute('data-attention', 'true');
});

test('recovers when the model becomes readable after the request timed out', async () => {
  const { panel } = await setupCase({ ...twoSum, lateModel: true });

  await expect(panel.locator('#captured-code')).toHaveText(twoSum.code!);
  await expect(panel.locator('#code-language')).toHaveText('Python');
  await expect(panel.locator('#outcome-actions')).toBeVisible();
});

test('captures the whole model when the view renders only part of it', async () => {
  const longSolution = Array.from(
    { length: 40 },
    (_, index) => `line_${index + 1} = ${index}`,
  ).join('\n');
  const { problem, panel } = await setupCase({
    ...twoSum,
    code: longSolution,
    renderedLines: 5,
  });

  // The page really is showing a fraction of the solution.
  await expect(problem.locator('.view-lines > .view-line')).toHaveCount(5);

  await expect(panel.locator('#code-line-count')).toHaveText('40 lines');
  await expect(panel.locator('#captured-code')).toHaveText(longSolution);

  await choose(panel, 'Solved');
  await expect(panel.locator('#success-confirmation')).toBeVisible();
  const event = JSON.parse(bridge.posts()[0]!.body!) as { attempt: { code: string } };
  expect(event.attempt.code).toBe(longSolution);
  expect(event.attempt.code.split('\n')).toHaveLength(40);
});

test('renders a due status from the authenticated status endpoint without posting', async () => {
  const { panel } = await setupCase(twoSum, TEST_BRIDGE_TOKEN, () => {
    bridge.statusReply = {
      kind: 'response',
      status: 200,
      body: {
        found: true,
        practiceState: 'Needed help',
        solvedStreak: 0,
        nextReview: '2000-01-01',
        lastAttempt: '2000-01-01T12:30:00.000Z',
      },
    };
  });

  await expect(panel.locator('#review-state')).toHaveText('Due now');
  expect(bridge.posts()).toHaveLength(0);
});

test('does not POST for loading, status checks, content updates, or SPA navigation', async () => {
  const { problem, panel } = await setupCase();
  await expect(panel.locator('#review-state')).toHaveText('New');
  await setCode(problem, 'const changed = true;', true);
  await expect(panel.locator('#captured-code')).toHaveText('const changed = true;');
  const requestMark = bridge.requests.length;
  await replaceProblem(problem, secondProblem);
  await expect(panel.locator('#problem-title')).toHaveText(secondProblem.title);
  expect(bridge.posts()).toHaveLength(0);
  await expectOnlyStatusPathSince(requestMark, `/api/problems/${secondProblem.slug}/status`);
});

for (const result of ['Needed help', 'Solved'] as const) {
  test(`${result} sends one exact v2 event after the click`, async () => {
    const { panel } = await setupCase();
    await choose(panel, result);
    await expect(panel.locator('#success-confirmation')).toHaveText('Attempt logged.');
    await expect(panel.locator('#outcome-actions')).toBeVisible();
    await expect(panel.locator(`button[data-result=${JSON.stringify(result)}]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(bridge.posts()).toHaveLength(1);
    const body = bridge.posts()[0]?.body;
    expect(body).not.toBeNull();
    const event = JSON.parse(body!) as Record<string, Record<string, unknown> | string>;
    expect(Object.keys(event).sort()).toEqual(['attempt', 'clientEventId', 'problem']);
    expect(Object.keys(event.problem as Record<string, unknown>).sort()).toEqual([
      'difficulty',
      'number',
      'slug',
      'title',
      'topics',
      'url',
    ]);
    expect(Object.keys(event.attempt as Record<string, unknown>).sort()).toEqual([
      'attemptedAt',
      'attemptedOn',
      'code',
      'language',
      'result',
    ]);
    expect(event.problem).toEqual({
      slug: twoSum.slug,
      title: twoSum.title,
      number: twoSum.number,
      url: `https://leetcode.com/problems/${twoSum.slug}/`,
      difficulty: twoSum.difficulty,
      topics: ['Array', 'Hash Table'],
    });
    expect(event.attempt).toEqual({
      attemptedAt: expect.any(String),
      attemptedOn: expect.any(String),
      language: 'Python',
      code: twoSum.code,
      result,
    });
    expect(event.clientEventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const attempt = event.attempt as Record<string, string>;
    expect(new Date(attempt.attemptedAt!).toISOString()).toBe(attempt.attemptedAt);
    const local = new Date(attempt.attemptedAt!);
    expect(attempt.attemptedOn).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`,
    );
  });
}

test('SPA publication rebinds status and logs only the current fingerprint', async () => {
  const { problem, panel } = await setupCase();
  const requestMark = bridge.requests.length;
  bridge.statusReply = {
    kind: 'response',
    status: 200,
    body: {
      found: true,
      practiceState: 'Mastered',
      solvedStreak: 5,
      nextReview: null,
      lastAttempt: '2026-07-20T12:30:00.000Z',
    },
  };
  await replaceProblem(problem, secondProblem);
  await expect(panel.locator('#problem-title')).toHaveText(secondProblem.title);
  await expect(panel.locator('#review-state')).toHaveText('Mastered');
  await expectOnlyStatusPathSince(requestMark, `/api/problems/${secondProblem.slug}/status`);
  await choose(panel, 'Solved');
  await expect(panel.locator('#success-confirmation')).toBeVisible();
  const event = JSON.parse(bridge.posts()[0]!.body!) as Record<string, any>;
  expect(event.problem.slug).toBe(secondProblem.slug);
  expect(event.attempt.code).toBe(secondProblem.code);
});

test('missing/wrong token and unreachable status remain actionable without a POST', async () => {
  let current = await setupCase(twoSum, null);
  await expect(current.panel.locator('#status')).toContainText('save your bridge token');
  await expect(current.panel.locator('#open-options')).toHaveAttribute('data-attention', 'true');
  expect(bridge.posts()).toHaveLength(0);

  current = await setupCase(twoSum, 'wrong-browser-suite-token-value');
  await expect(current.panel.locator('#status')).toContainText('authorization failed');
  await expect(current.panel.locator('#open-options')).toHaveAttribute('data-attention', 'true');
  expect(bridge.posts()).toHaveLength(0);

  current = await setupCase(twoSum, TEST_BRIDGE_TOKEN, () => {
    bridge.statusReply = { kind: 'disconnect' };
  });
  await expect(current.panel.locator('#status')).toContainText('Start it');
  expect(bridge.posts()).toHaveLength(0);
});

test('missing or blank model code blocks capture', async () => {
  let current = await setupCase({ ...twoSum, code: null });
  await expect(current.panel.locator('#status')).toContainText('Open the LeetCode code editor');
  await expect(current.panel.locator('#outcome-actions')).toBeHidden();
  expect(bridge.posts()).toHaveLength(0);

  current = await setupCase({ ...twoSum, code: '   ' });
  await expect(current.panel.locator('#status')).toContainText('non-blank code');
  await expect(current.panel.locator('#outcome-actions')).toBeHidden();
  expect(bridge.posts()).toHaveLength(0);
});

test('network, 5xx, and invalid-success uncertainty retain the exact serialized retry', async () => {
  for (const uncertain of [
    { kind: 'disconnect' },
    { kind: 'response', status: 503, body: { error: 'Unavailable' } },
    { kind: 'response', status: 200, body: { ok: true } },
  ] satisfies BridgeReply[]) {
    const { problem, panel } = await setupCase();
    bridge.captureReplies.push(
      uncertain,
      ...(uncertain.kind === 'disconnect' ? ([{ kind: 'disconnect' }] as BridgeReply[]) : []),
      successReply(),
    );
    await choose(panel, 'Needed help');
    await expectSoleRetry(panel);
    const firstBody = bridge.posts()[0]!.body;
    const automaticAttempts = bridge.posts().length;
    expect(bridge.posts().every((request) => request.body === firstBody)).toBe(true);
    await panel.close();
    const reopened = await openPanel(problem);
    await expectSoleRetry(reopened);
    await retry(reopened);
    await expect(reopened.locator('#success-confirmation')).toBeVisible();
    expect(bridge.posts()).toHaveLength(automaticAttempts + 1);
    expect(bridge.posts().at(-1)!.body).toBe(firstBody);
  }
});

test('definitive validation clears pending, auth points to Settings, and duplicate locks success', async () => {
  let current = await setupCase();
  bridge.captureReplies.push(
    { kind: 'response', status: 422, body: { error: 'Invalid capture' } },
    successReply(),
  );
  await choose(current.panel, 'Solved');
  await bridge.waitForPosts(1);
  await expect(current.panel.locator('#status')).toContainText('rejected');
  await expect(current.panel.locator('#outcome-actions')).toBeVisible();
  const rejected = JSON.parse(bridge.posts()[0]!.body!);
  await choose(current.panel, 'Solved');
  await bridge.waitForPosts(2);
  await expect(current.panel.locator('#success-confirmation')).toBeVisible();
  const accepted = JSON.parse(bridge.posts()[1]!.body!);
  expect(accepted.clientEventId).not.toBe(rejected.clientEventId);

  current = await setupCase();
  bridge.captureReplies.push({ kind: 'response', status: 403, body: { error: 'Forbidden' } });
  await choose(current.panel, 'Solved');
  await expect(current.panel.locator('#status')).toContainText('authorization failed');
  await expect(current.panel.locator('#open-options')).toHaveAttribute('data-attention', 'true');

  current = await setupCase();
  bridge.captureReplies.push(successReply(true));
  await choose(current.panel, 'Solved');
  await expect(current.panel.locator('#status')).toContainText('Already logged');
  await expect(current.panel.locator('#success-confirmation')).toBeVisible();
});

test('same-fingerprint attempts remain active across reload and use distinct event IDs', async () => {
  const { problem, panel } = await setupCase();
  await choose(panel, 'Solved');
  await expect(panel.locator('#success-confirmation')).toBeVisible();
  await expect(panel.locator('#outcome-actions')).toBeVisible();
  expect(await readSessionForPage(problem)).toMatchObject({
    pending: null,
    lastSuccess: { version: 2, result: 'Solved' },
  });
  await panel.close();
  const reopened = await openPanel(problem);
  expect(await readSessionForPage(problem)).toMatchObject({
    pending: null,
    lastSuccess: { version: 2, result: 'Solved' },
  });
  await expect(reopened.locator('#success-confirmation')).toBeVisible();
  await expect(reopened.locator('#outcome-actions')).toBeVisible();
  await choose(reopened, 'Needed help');
  await bridge.waitForPosts(2);
  const first = JSON.parse(bridge.posts()[0]!.body!);
  const second = JSON.parse(bridge.posts()[1]!.body!);
  expect(second.clientEventId).not.toBe(first.clientEventId);
  expect(second.attempt.code).toBe(first.attempt.code);
  await expect(reopened.locator('button[data-result="Needed help"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(bridge.posts()).toHaveLength(2);

  await setCode(problem, `${twoSum.code}\n# changed`, true);
  await expect(reopened.locator('#outcome-actions')).toBeVisible();
  await expect(reopened.locator('#success-confirmation')).toBeHidden();
  expect(bridge.posts()).toHaveLength(2);
});

test('pending uncertainty remains tab-scoped across page and active-tab changes', async () => {
  const { problem: first, panel } = await setupCase();
  bridge.captureReplies.push({ kind: 'disconnect' }, { kind: 'disconnect' }, successReply());
  await choose(panel, 'Needed help');
  await expectSoleRetry(panel);
  const firstBody = bridge.posts()[0]!.body;
  await replaceProblem(first, secondProblem);
  await expectSoleRetry(panel);

  const second = await openProblem(secondProblem);
  await second.bringToFront();
  await expect(panel.locator('#problem-title')).toHaveText(secondProblem.title);
  await expect(panel.locator('#outcome-actions')).toBeVisible();
  await first.bringToFront();
  await expectSoleRetry(panel);
  await retry(panel);
  await expect(panel.locator('#outcome-actions')).toBeVisible();
  expect(bridge.posts().at(-1)!.body).toBe(firstBody);
});

test('click-time mismatch refreshes without POST and a second deliberate click succeeds', async () => {
  const { problem, panel } = await setupCase();
  await setCode(problem, 'fresh code at click time', false);
  await choose(panel, 'Solved');
  await expect(panel.locator('#status')).toContainText('code changed');
  await expect(panel.locator('#captured-code')).toHaveText('fresh code at click time');
  expect(bridge.posts()).toHaveLength(0);
  await choose(panel, 'Solved');
  await expect(panel.locator('#success-confirmation')).toBeVisible();
  expect(bridge.posts()).toHaveLength(1);
});

test('rapid double click plus context publication during an in-flight POST sends once', async () => {
  const { problem, panel } = await setupCase();
  bridge.captureReplies.push({ kind: 'deferred' });
  const button = panel.locator('button[data-result="Solved"]');
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click({ clickCount: 2 });
  await bridge.waitForPosts(1);
  await setCode(problem, `${twoSum.code}\n# during request`, true);
  await expectSoleRetry(panel, true);
  expect(bridge.posts()).toHaveLength(1);
  bridge.resolveDeferred();
  await expect(panel.locator('#outcome-actions')).toBeVisible();
  expect(bridge.posts()).toHaveLength(1);
});
