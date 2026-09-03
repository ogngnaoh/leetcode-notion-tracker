// A disposable Chromium profile with no debugger attached to its extension worker.
// Run: node --import tsx scripts/benchmark/direct-idle.ts
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NotionVault, type VaultStorageArea } from '../../extension/src/notion-vault.js';
import { directManifest } from './direct-fixture.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function area(): VaultStorageArea & { values: Record<string, unknown> } {
  return {
    values: {},
    async get(keys) {
      const names =
        keys === null ? Object.keys(this.values) : typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(
        names.filter((key) => key in this.values).map((key) => [key, this.values[key]]),
      );
    },
    async set(values) {
      Object.assign(this.values, values);
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    },
    async setAccessLevel() {},
  };
}
const local = area();
const session = area();
const vault = new NotionVault({ local, session });
await vault.create(
  {
    token: 'synthetic-idle-only-credential',
    manifest: directManifest,
    pending: null,
    completed: null,
    preferences: { dailyNewProblemGoal: 10 },
    preferenceRevision: 0,
  },
  'synthetic browser idle passphrase',
);
const profile = await mkdtemp(join(tmpdir(), 'lctrack-direct-idle-'));
const logPath = join(profile, 'netlog.json');
const extension = resolve('dist/extension');
const child = spawn(
  chromium.executablePath(),
  [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-component-extensions-with-background-pages',
    '--disable-sync',
    '--password-store=basic',
    '--use-mock-keychain',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--host-resolver-rules=MAP api.notion.com ~NOTFOUND, MAP leetcode.com ~NOTFOUND',
    `--log-net-log=${logPath}`,
    'about:blank',
  ],
  { stdio: 'ignore', env: { PATH: process.env.PATH, TMPDIR: profile } },
);
const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
let socket: WebSocket | undefined;
try {
  let endpoint = '';
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Isolated Chromium exited before initialization.');
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split('\n');
      endpoint = `ws://127.0.0.1:${port}${path}`;
      break;
    } catch {
      await pause(100);
    }
  }
  if (!endpoint) throw new Error('Isolated Chromium did not publish its debugging endpoint.');
  socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true });
    socket!.addEventListener(
      'error',
      () => reject(new Error('Isolated browser connection failed.')),
      { once: true },
    );
  });
  let sequence = 0;
  const waiting = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(String(event.data));
    if (!value.id) return;
    const pending = waiting.get(value.id);
    waiting.delete(value.id);
    if (pending) clearTimeout(pending.timer);
    if (value.error) pending?.reject(new Error(value.error.message));
    else pending?.resolve(value.result);
  });
  const send = (method: string, params: unknown = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`Browser control timed out during ${method}.`));
      }, 15_000);
      waiting.set(id, { resolve, reject, timer });
      socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  let worker: { targetId: string; url: string; attached: boolean } | undefined;
  for (let i = 0; i < 100; i++) {
    worker = (await send('Target.getTargets')).targetInfos.find(
      (t: any) =>
        t.type === 'service_worker' &&
        t.url.startsWith('chrome-extension://') &&
        t.url.endsWith('/background.js'),
    );
    if (worker) break;
    await pause(100);
  }
  if (!worker || worker.attached) throw new Error('Expected an unattached extension worker.');
  const extensionId = new URL(worker.url).hostname;
  const options = await send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/options.html`,
  });
  const attached = await send('Target.attachToTarget', {
    targetId: options.targetId,
    flatten: true,
  });
  for (let i = 0; i < 100; i++) {
    const ready = await send(
      'Runtime.evaluate',
      { expression: '!!globalThis.chrome?.storage?.local', returnByValue: true },
      attached.sessionId,
    );
    if (ready.result.value) break;
    if (i === 99) {
      const location = await send(
        'Runtime.evaluate',
        { expression: 'location.href', returnByValue: true },
        attached.sessionId,
      );
      throw new Error(`Synthetic options API unavailable at ${location.result.value}`);
    }
    await pause(100);
  }
  // Own synthetic profile only: seed encrypted bytes, then perform an ordinary explicit Unlock.
  // The session grant is created by the packaged extension inside Chrome.
  const seeded = await send(
    'Runtime.evaluate',
    {
      expression: `(async()=>{await chrome.storage.local.set(${JSON.stringify(local.values)});return true;})()`,
      awaitPromise: true,
      returnByValue: true,
    },
    attached.sessionId,
  );
  if (seeded.exceptionDetails || seeded.result.value !== true)
    throw new Error(
      `Could not seed synthetic vault: ${seeded.exceptionDetails?.exception?.description ?? seeded.exceptionDetails?.text ?? seeded.result.description ?? seeded.result.type}`,
    );
  await send(
    'Page.navigate',
    { url: `chrome-extension://${extensionId}/sidepanel.html` },
    attached.sessionId,
  );
  for (let i = 0; i < 100; i++) {
    const ready = await send(
      'Runtime.evaluate',
      {
        expression:
          "document.readyState === 'complete' && !!globalThis.chrome?.runtime?.sendMessage",
        returnByValue: true,
      },
      attached.sessionId,
    );
    if (ready.result.value) break;
    if (i === 99) throw new Error('Synthetic side panel did not become ready.');
    await pause(100);
  }
  const unlockedResponse = await send(
    'Runtime.evaluate',
    {
      expression: `(async()=>await chrome.runtime.sendMessage({type:'lctrack.notion',version:1,id:crypto.randomUUID(),op:'connection.unlock',passphrase:'synthetic browser idle passphrase'}))()`,
      awaitPromise: true,
      returnByValue: true,
    },
    attached.sessionId,
  );
  if (unlockedResponse.exceptionDetails || unlockedResponse.result.value?.ok !== true)
    throw new Error(
      `Synthetic Unlock failed: ${unlockedResponse.result.value?.code ?? unlockedResponse.exceptionDetails?.text ?? 'unknown'}`,
    );
  let unlocked = false;
  let lastStatus = '';
  for (let i = 0; i < 100; i++) {
    const state = await send(
      'Runtime.evaluate',
      {
        expression: "document.getElementById('connection-state')?.textContent",
        returnByValue: true,
      },
      attached.sessionId,
    );
    lastStatus = String(state.result.value);
    if (state.result.value === 'Unlocked for this browser session') {
      unlocked = true;
      break;
    }
    await pause(100);
  }
  if (!unlocked)
    throw new Error(`The synthetic idle vault did not hydrate unlocked: ${lastStatus}`);
  await send('Target.closeTarget', { targetId: options.targetId });
  const begin = performance.now();
  let retiredAtMs: number | null = null;
  const observationMs = 65_000;
  while (performance.now() - begin < observationMs) {
    const workers = (await send('Target.getTargets')).targetInfos.filter(
      (t: any) =>
        t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extensionId}/`),
    );
    if (workers.some((t: any) => t.attached))
      throw new Error('Idle proof invalid: a debugger attached to the worker.');
    if (workers.length === 0 && retiredAtMs === null) retiredAtMs = performance.now() - begin;
    if (retiredAtMs !== null && workers.length !== 0)
      throw new Error('Idle extension worker restarted without an action.');
    await pause(1000);
  }
  await send('Browser.close').catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([exited, pause(10_000)]);
  }
  if (child.exitCode === null && child.signalCode === null)
    throw new Error('Isolated Chromium did not exit after its idle observation.');
  const netlog = JSON.parse(await readFile(logPath, 'utf8'));
  const notionEvents = netlog.events.filter(
    (event: any) =>
      typeof event.params?.url === 'string' &&
      event.params.url.startsWith('https://api.notion.com/'),
  );
  if (retiredAtMs === null) throw new Error('Idle worker did not retire during the observation.');
  if (notionEvents.length !== 0)
    throw new Error('Idle extension attempted Notion network traffic.');
  const result = {
    generatedAt: new Date().toISOString(),
    observationMs,
    retiredAtMs,
    notionNetworkEvents: notionEvents.length,
    workerDebuggerAttached: false,
    mode: 'ordinary Chromium; browser target observation only; no Playwright connection; synthetic unlocked vault; no panels left open',
  };
  await mkdir('build/direct-benchmark', { recursive: true });
  await writeFile('build/direct-benchmark/idle.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([exited, pause(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
  await rm(profile, { recursive: true, force: true });
}
