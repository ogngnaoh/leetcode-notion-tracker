import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DirectSyntheticNotion, directManifest } from '../../scripts/benchmark/direct-fixture.js';
import { fixtureHtml, type ProblemFixture } from './problem-fixtures.js';
import type {
  NotionOperation,
  NotionResponse,
  NotionState,
} from '../../extension/src/notion-protocol.js';

export const TEST_PASSPHRASE = 'synthetic browser test passphrase';
export const TEST_NOTION_TOKEN = 'synthetic-notion-test-token';
export interface DirectNetworkRequest {
  method: string;
  url: string;
  body: string | undefined;
}

/** Owns a disposable profile and intercepts every extension-worker request before network dispatch. */
export class DirectExtensionFixture {
  context!: BrowserContext;
  extensionId = '';
  readonly notion = new DirectSyntheticNotion();
  readonly network: DirectNetworkRequest[] = [];
  readonly errors: string[] = [];
  private profile = '';
  private socket!: WebSocket;
  private nextId = 0;
  private readonly sessions = new Set<string>();
  private readonly responses = new Map<
    number,
    { resolve(value: any): void; reject(error: unknown): void }
  >();

  async launch(): Promise<void> {
    this.profile ||= await mkdtemp(join(tmpdir(), 'lctrack-direct-mv3-'));
    const extensionPath = resolve('dist/extension');
    this.context = await chromium.launchPersistentContext(this.profile, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-background-networking',
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        '--host-resolver-rules=MAP api.notion.com ~NOTFOUND',
      ],
    });
    this.context.on('page', (page) => {
      page.on('pageerror', (error) => this.errors.push(`Page error: ${error.message}`));
    });
    const worker =
      this.context.serviceWorkers()[0] ?? (await this.context.waitForEvent('serviceworker'));
    this.extensionId = new URL(worker.url()).hostname;
    const [port, browserPath] = (await readFile(join(this.profile, 'DevToolsActivePort'), 'utf8'))
      .trim()
      .split('\n');
    this.socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener(
        'error',
        () => reject(new Error('Could not connect to isolated browser CDP.')),
        { once: true },
      );
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.responses.get(message.id);
        this.responses.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
      } else if (message.method === 'Target.detachedFromTarget') {
        this.sessions.delete(message.params.sessionId);
      } else if (message.method === 'Fetch.requestPaused') {
        void this.fulfill(message.sessionId, message.params).catch((error: unknown) =>
          this.recordError(error),
        );
      } else if (
        message.method === 'Target.attachedToTarget' &&
        message.params.targetInfo.type === 'service_worker'
      ) {
        void this.install(message.params.sessionId).catch((error: unknown) =>
          this.recordError(error),
        );
      }
    });
    await this.send('', 'Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: 'service_worker' }, { exclude: true }],
    });
    const { targetInfos } = await this.send('', 'Target.getTargets');
    for (const target of targetInfos) {
      if (
        target.type === 'service_worker' &&
        target.url.startsWith(`chrome-extension://${this.extensionId}/`)
      ) {
        if (!target.attached) {
          const attached = await this.send('', 'Target.attachToTarget', {
            targetId: target.targetId,
            flatten: true,
          });
          await this.install(attached.sessionId);
        }
      }
    }
    await expect.poll(() => this.sessions.size).toBeGreaterThan(0);
    // Blocks all ordinary-page requests unless an explicit per-problem fixture overrides it.
    await this.context.route('http{,s}://**/*', (route) => route.abort('blockedbyclient'));
  }

  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /session.*(?:not found|closed)|(?:no|invalid).*session|target.*closed|invalid interception/i.test(
        message,
      )
    )
      return;
    this.errors.push(message);
  }
  private send(sessionId: string, method: string, params: unknown = {}): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.responses.set(id, { resolve, reject });
      try {
        this.socket.send(
          JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
        );
      } catch (error) {
        this.responses.delete(id);
        reject(error);
      }
    });
  }
  private async install(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return;
    await this.send(sessionId, 'Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    });
    await this.send(sessionId, 'Runtime.runIfWaitingForDebugger');
    this.sessions.add(sessionId);
  }
  private async fulfill(sessionId: string, paused: any): Promise<void> {
    const request = paused.request;
    const record = {
      method: request.method as string,
      url: request.url as string,
      body: request.postData as string | undefined,
    };
    this.network.push(record);
    if (!request.url.startsWith('https://api.notion.com/v1/')) {
      await this.send(sessionId, 'Fetch.failRequest', {
        requestId: paused.requestId,
        errorReason: 'BlockedByClient',
      });
      return;
    }
    try {
      const response = await this.notion.respond(request.url, {
        method: request.method,
        ...(request.postData ? { body: request.postData } : {}),
      });
      await this.send(sessionId, 'Fetch.fulfillRequest', {
        requestId: paused.requestId,
        responseCode: response.status,
        responseHeaders: [...response.headers].map(([name, value]) => ({ name, value })),
        body: Buffer.from(await response.text()).toString('base64'),
      });
    } catch {
      await this.send(sessionId, 'Fetch.failRequest', {
        requestId: paused.requestId,
        errorReason: 'ConnectionClosed',
      });
    }
  }

  async problem(fixture: ProblemFixture): Promise<Page> {
    const page = await this.context.newPage();
    await page.route('https://leetcode.com/**', async (route) => {
      if (
        route.request().isNavigationRequest() &&
        new URL(route.request().url()).pathname.startsWith(`/problems/${fixture.slug}/`)
      ) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml(fixture) });
      } else await route.abort('blockedbyclient');
    });
    await page.goto(`https://leetcode.com/problems/${fixture.slug}/${fixture.route ?? ''}`);
    return page;
  }
  async panel(problem?: Page): Promise<Page> {
    const panel = await this.context.newPage();
    await panel.goto(`chrome-extension://${this.extensionId}/sidepanel.html`);
    if (problem) await problem.bringToFront();
    await expect(panel.locator('#connection-state')).not.toHaveText('Loading connection…');
    if (problem)
      await expect(panel.locator('#daily-problem-title')).not.toHaveText(
        /Open a LeetCode problem/i,
      );
    return panel;
  }
  async connect(panel: Page, preferences = { dailyNewProblemGoal: 10 }): Promise<void> {
    const state = await this.rpc(panel, {
      op: 'connection.connect',
      manifest: directManifest,
      preferences,
      token: TEST_NOTION_TOKEN,
      passphrase: TEST_PASSPHRASE,
    });
    expect(state.connection.unlocked).toBe(true);
    await panel.reload();
  }
  async rpc(panel: Page, operation: NotionOperation, attempts = 0): Promise<NotionState> {
    const response = await panel.evaluate(
      async (command) =>
        chrome.runtime.sendMessage({
          type: 'lctrack.notion',
          version: 1,
          id: crypto.randomUUID(),
          ...command,
        }) as Promise<NotionResponse>,
      operation,
    );
    if (!response.ok) {
      if (
        response.code === 'STALE_STATE' &&
        attempts < 2 &&
        (operation.op === 'connection.state' || operation.op === 'capture.pending')
      )
        return this.rpc(panel, operation, attempts + 1);
      throw new Error(`${response.code}: ${response.message}`);
    }
    return response.data;
  }
  async reset(): Promise<void> {
    await Promise.all(this.context.pages().map((page) => page.close()));
    const worker = this.context.serviceWorkers()[0];
    if (worker)
      await worker.evaluate(async () => {
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
      });
    this.notion.reset();
    delete this.notion.beforeRequest;
    delete this.notion.afterRequest;
    this.network.length = 0;
    this.errors.length = 0;
  }
  browserCommand(method: string, params: unknown = {}): Promise<any> {
    return this.send('', method, params);
  }
  async workerTargetIds(): Promise<string[]> {
    const { targetInfos } = await this.send('', 'Target.getTargets');
    return targetInfos
      .filter(
        (target: any) =>
          target.type === 'service_worker' &&
          target.url.startsWith(`chrome-extension://${this.extensionId}/`),
      )
      .map((target: any) => target.targetId as string);
  }
  async stopWorker(): Promise<void> {
    const ids = await this.workerTargetIds();
    for (const targetId of ids) await this.send('', 'Target.closeTarget', { targetId });
    await expect
      .poll(async () => (await this.workerTargetIds()).filter((id) => ids.includes(id)))
      .toEqual([]);
  }
  async restart(): Promise<void> {
    this.socket?.close();
    await this.context.close();
    this.sessions.clear();
    this.responses.clear();
    await this.launch();
  }
  async close(): Promise<void> {
    this.socket?.close();
    await this.context?.close();
    if (this.profile) await rm(this.profile, { recursive: true, force: true });
  }
}
