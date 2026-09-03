import { expect, test, type Page } from '@playwright/test';
import {
  DirectExtensionFixture,
  TEST_NOTION_TOKEN,
  TEST_PASSPHRASE,
} from './direct-extension-fixture.js';
import { twoSum } from './problem-fixtures.js';
import { captureEvent } from '../../scripts/benchmark/fixture.js';
import { VAULT_STORAGE_KEYS } from '../../extension/src/notion-vault.js';

// These checks need a disposable installed extension, worker termination and full profile restart.
// They intentionally use the repository's synthetic MV3 harness, not a normal signed-in browser.
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

async function sourceTabId(panel: Page, url: string): Promise<number> {
  return panel.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (tab?.id === undefined) throw new Error('Synthetic source tab was not found.');
    return tab.id;
  }, url);
}

test('worker termination preserves session unlock while a full Chrome restart locks the same encrypted connection', async () => {
  const problem = await fixture.problem(twoSum);
  let panel = await fixture.panel(problem);
  await fixture.connect(panel);
  const before = await fixture.rpc(panel, { op: 'connection.state' });
  const network = fixture.network.length;
  const workersBefore = await fixture.workerTargetIds();
  expect(workersBefore).toHaveLength(1);
  await fixture.context.serviceWorkers()[0]!.evaluate(() => {
    (globalThis as typeof globalThis & { lifecycleSentinel?: boolean }).lifecycleSentinel = true;
  });
  await fixture.stopWorker();
  expect((await fixture.workerTargetIds()).filter((id) => workersBefore.includes(id))).toEqual([]);
  const resumed = await fixture.rpc(panel, { op: 'connection.state' });
  expect(await fixture.workerTargetIds()).toHaveLength(1);
  // Chromium may reuse its registration's target ID; a cleared worker global proves a new realm.
  expect(
    await fixture.context
      .serviceWorkers()[0]!
      .evaluate(
        () => (globalThis as typeof globalThis & { lifecycleSentinel?: boolean }).lifecycleSentinel,
      ),
  ).toBeUndefined();
  expect(resumed.connection).toMatchObject({
    configured: true,
    unlocked: true,
    vaultId: before.connection.vaultId,
  });
  expect(fixture.network).toHaveLength(network);

  const stored = await panel.evaluate(
    async (keys) => ({
      local: await chrome.storage.local.get(keys.root),
      session: await chrome.storage.session.get(keys.grant),
    }),
    VAULT_STORAGE_KEYS,
  );
  expect(JSON.stringify(stored.local)).not.toContain(TEST_NOTION_TOKEN);
  expect(stored.session[VAULT_STORAGE_KEYS.grant]).toBeDefined();

  await fixture.restart();
  panel = await fixture.panel();
  const locked = await fixture.rpc(panel, { op: 'connection.state' });
  expect(locked.connection).toMatchObject({
    configured: true,
    unlocked: false,
    vaultId: before.connection.vaultId,
  });
  expect(locked.preferences).toBeNull();
  expect(locked.review).toBeNull();
  expect(fixture.network).toHaveLength(network);
  expect(
    await panel.evaluate(
      async (key) => (await chrome.storage.session.get(key))[key],
      VAULT_STORAGE_KEYS.grant,
    ),
  ).toBeUndefined();
  expect(
    (await fixture.rpc(panel, { op: 'connection.unlock', passphrase: TEST_PASSPHRASE })).connection
      .unlocked,
  ).toBe(true);
  expect(fixture.network).toHaveLength(network);
});

test('terminating the worker after a remote create commits retains the encrypted intent before any reply', async () => {
  const problem = await fixture.problem(twoSum);
  const panel = await fixture.panel(problem);
  await fixture.connect(panel);
  const event = captureEvent(0);
  const source = {
    tabId: await sourceTabId(panel, problem.url()),
    fingerprint: 'terminated-worker-source',
  };
  let release!: () => void;
  let arrived!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let stoppedOnce = false;
  fixture.notion.afterRequest = async (request) => {
    if (!stoppedOnce && request.method === 'POST' && request.path === '/v1/pages') {
      stoppedOnce = true;
      arrived();
      await pendingResponse;
    }
  };
  const saving = fixture.rpc(panel, { op: 'capture.submit', event, source }).then(
    () => 'unexpected success',
    () => 'worker terminated',
  );
  await committed;
  try {
    await fixture.stopWorker();
  } finally {
    release();
  }
  expect(await saving).toBe('worker terminated');
  delete fixture.notion.afterRequest;
  expect(await fixture.rpc(panel, { op: 'capture.pending' })).toMatchObject({
    connection: { unlocked: true },
    pending: { event, source, disposition: 'check' },
  });
  const mutations = fixture.notion.counts.mutations;
  expect(
    await fixture.rpc(panel, { op: 'capture.check', eventId: event.clientEventId }),
  ).toMatchObject({ pending: { event, disposition: 'retry' } });
  expect(fixture.notion.counts.mutations).toBe(mutations);
  expect(
    await fixture.rpc(panel, { op: 'capture.retry', eventId: event.clientEventId }),
  ).toMatchObject({
    pending: null,
    completed: { eventId: event.clientEventId, result: { review: { solvedStreak: 1 } } },
  });
  expect(
    fixture.network.filter(
      (request) => request.method === 'POST' && request.url.endsWith('/v1/pages'),
    ),
  ).toHaveLength(2);
});

test('actual isolated content-script contexts cannot access vault/session credentials or invoke Notion commands', async () => {
  const problem = await fixture.problem(twoSum);
  const panel = await fixture.panel(problem);
  await fixture.connect(panel);
  const tabId = await sourceTabId(panel, problem.url());
  const result = await panel.evaluate(
    async ({ tabId, root, grant }) => {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        args: [root, grant],
        func: async (root, grant) => {
          let localDenied = false;
          let sessionDenied = false;
          try {
            const value = await chrome.storage.local.get(root);
            localDenied = value[root] === undefined;
          } catch {
            localDenied = true;
          }
          try {
            const value = await chrome.storage.session.get(grant);
            sessionDenied = value[grant] === undefined;
          } catch {
            sessionDenied = true;
          }
          const response = await chrome.runtime.sendMessage({
            type: 'lctrack.notion',
            version: 1,
            id: 'forged-content-script-request',
            op: 'connection.state',
          });
          return {
            localDenied,
            sessionDenied,
            forbidden: response?.ok === false && response.code === 'FORBIDDEN',
          };
        },
      });
      return execution?.result;
    },
    { tabId, root: VAULT_STORAGE_KEYS.root, grant: VAULT_STORAGE_KEYS.grant },
  );
  expect(result).toEqual({ localDenied: true, sessionDenied: true, forbidden: true });
  const network = fixture.network.length;
  expect((await fixture.rpc(panel, { op: 'connection.lock' })).connection.unlocked).toBe(false);
  const privateKeys = await panel.evaluate(async () =>
    Object.keys(await chrome.storage.session.get(null)).filter(
      (key) => key.startsWith('lctrack.notion.private.') || key === 'lctrack.notion.grant.v1',
    ),
  );
  expect(privateKeys).toEqual([]);
  expect(fixture.network).toHaveLength(network);
});

test('a lost committed create survives source closure and full restart with read-only Check and the original frozen retry', async () => {
  const event = captureEvent(0);
  const problem = await fixture.problem({ ...twoSum, code: event.attempt.code });
  let panel = await fixture.panel(problem);
  await fixture.connect(panel);
  const source = {
    tabId: await sourceTabId(panel, problem.url()),
    fingerprint: 'frozen-browser-source',
    navigationId: 3,
  };
  let reached!: () => void;
  let release!: () => void;
  const committed = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const holdResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  let loseOnce = true;
  fixture.notion.afterRequest = async (request) => {
    if (loseOnce && request.method === 'POST' && request.path === '/v1/pages') {
      loseOnce = false;
      reached();
      await holdResponse;
      throw new Error('Synthetic committed response was lost');
    }
  };
  const saving = fixture.rpc(panel, { op: 'capture.submit', event, source });
  const failed = saving.then(
    () => 'unexpected success',
    (error: Error) => error.message,
  );
  await committed;
  await problem.close();
  release();
  expect(await failed).toContain('UNAVAILABLE');
  delete fixture.notion.afterRequest;
  expect(await fixture.rpc(panel, { op: 'capture.pending' })).toMatchObject({
    pending: { event, source, disposition: 'check' },
  });
  const serialized = await panel.evaluate(async () =>
    JSON.stringify({
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
    }),
  );
  expect(serialized).not.toContain('def twoSum');
  expect(serialized).not.toContain(TEST_NOTION_TOKEN);
  const network = fixture.network.length;
  await fixture.restart();
  panel = await fixture.panel();
  const locked = await fixture.rpc(panel, { op: 'capture.pending' });
  expect(locked).toMatchObject({
    connection: { unlocked: false, hasPending: true },
    pending: null,
    completed: null,
  });
  expect(fixture.network).toHaveLength(network);
  await expect(
    fixture.rpc(panel, { op: 'capture.retry', eventId: event.clientEventId }),
  ).rejects.toThrow('LOCKED');
  expect(fixture.network).toHaveLength(network);
  const unlocked = await fixture.rpc(panel, {
    op: 'connection.unlock',
    passphrase: TEST_PASSPHRASE,
  });
  expect(unlocked.pending).toMatchObject({ event, source });
  expect(fixture.network).toHaveLength(network);
  const mutations = fixture.notion.counts.mutations;
  expect(
    await fixture.rpc(panel, { op: 'capture.check', eventId: event.clientEventId }),
  ).toMatchObject({ pending: { event, disposition: 'retry' } });
  expect(fixture.notion.counts.mutations).toBe(mutations);
  const completed = await fixture.rpc(panel, { op: 'capture.retry', eventId: event.clientEventId });
  expect(completed).toMatchObject({
    pending: null,
    completed: { eventId: event.clientEventId, source, result: { review: { solvedStreak: 1 } } },
  });
  expect(
    fixture.network.filter(
      (request) => request.method === 'POST' && request.url.endsWith('/v1/pages'),
    ),
  ).toHaveLength(2);
  const attemptPage = completed.completed!.result.attemptPageId;
  const blocks = await (
    await fixture.notion.respond(`https://api.notion.com/v1/blocks/${attemptPage}/children`)
  ).json();
  const code = blocks.results.find((block: any) => block.type === 'code');
  expect(
    code.code.rich_text.map((part: any) => part.plain_text ?? part.text.content).join(''),
  ).toBe(event.attempt.code);
});
