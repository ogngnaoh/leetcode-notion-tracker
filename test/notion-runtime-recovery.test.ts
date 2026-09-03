import { describe, expect, it } from 'vitest';
import { NotionRuntime } from '../extension/src/notion-runtime.js';
import type { VaultStorageArea } from '../extension/src/notion-vault.js';
import type { NotionOperation, NotionResponse } from '../extension/src/notion-protocol.js';
import { captureEvent } from '../scripts/benchmark/fixture.js';
import { DirectSyntheticNotion, directManifest } from '../scripts/benchmark/direct-fixture.js';

function memoryArea(): VaultStorageArea & { values: Record<string, unknown> } {
  return {
    values: {},
    async get(keys) {
      const names =
        keys === null ? Object.keys(this.values) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(
        Object.fromEntries(
          names.filter((key) => key in this.values).map((key) => [key, this.values[key]]),
        ),
      );
    },
    async set(values) {
      Object.assign(this.values, structuredClone(values));
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    },
    async setAccessLevel() {},
  };
}

const passphrase = 'four independent recovery test words';
const source = { tabId: 42, fingerprint: 'original-tab-fingerprint', navigationId: 7 };
type Boundary =
  | 'problem-create'
  | 'attempt-create'
  | 'container-append'
  | 'receipt-append'
  | 'code-update'
  | 'attempt-update'
  | 'problem-update'
  | 'receipt-complete';

function boundary(path: string, method: string, body: any): Boundary | null {
  if (method === 'POST' && path === '/v1/pages')
    return body.parent.data_source_id === directManifest.problems.dataSourceId
      ? 'problem-create'
      : 'attempt-create';
  if (method === 'PATCH' && path.endsWith('/children'))
    return body.children[0].type === 'toggle' ? 'container-append' : 'receipt-append';
  if (method === 'PATCH' && path.startsWith('/v1/blocks/') && body.code)
    return body.code.language === 'json' ? 'receipt-complete' : 'code-update';
  if (method === 'PATCH' && path.startsWith('/v1/pages/'))
    return body.properties['Client Event ID'] ? 'attempt-update' : 'problem-update';
  return null;
}

function fixture() {
  const storage = { local: memoryArea(), session: memoryArea() };
  const notion = new DirectSyntheticNotion();
  let now = Date.parse('2026-09-03T12:00:00.000Z');
  let failure: { boundary: Boundary; status?: number } | null = null;
  let hit = false;
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const kind = boundary(
      new URL(url).pathname,
      init.method ?? 'GET',
      typeof init.body === 'string' ? JSON.parse(init.body) : {},
    );
    if (failure?.boundary === kind) {
      const current = failure;
      failure = null;
      hit = true;
      if (current.status)
        return Response.json(
          {
            object: 'error',
            code: current.status === 401 ? 'unauthorized' : 'restricted_resource',
            message: 'synthetic rejection',
          },
          { status: current.status },
        );
      await notion.respond(url, init);
      throw new Error('Synthetic response lost after Notion committed');
    }
    return notion.respond(url, init);
  };
  let runtime = new NotionRuntime(storage, {
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const send = (operation: NotionOperation): Promise<NotionResponse> =>
    runtime.handle(
      { type: 'lctrack.notion', version: 1, id: crypto.randomUUID(), ...operation },
      { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
      'test',
    );
  const connect = () =>
    send({
      op: 'connection.connect',
      manifest: directManifest,
      preferences: { dailyNewProblemGoal: 10 },
      token: 'synthetic-recovery-credential',
      passphrase,
    });
  return {
    storage,
    notion,
    send,
    connect,
    fail(kind: Boundary, status?: number) {
      failure = { boundary: kind, ...(status ? { status } : {}) };
      hit = false;
    },
    get failed() {
      return hit;
    },
    restart(fullBrowser = false) {
      if (fullBrowser) storage.session.values = {};
      runtime = new NotionRuntime(storage, {
        fetch,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      });
    },
  };
}

async function rows(notion: DirectSyntheticNotion, dataSource: string): Promise<any[]> {
  return (
    await (
      await notion.respond(`https://api.notion.com/v1/data_sources/${dataSource}/query`, {
        method: 'POST',
        body: '{}',
      })
    ).json()
  ).results;
}

describe('runtime durable capture recovery', () => {
  it.each<Boundary>([
    'problem-create',
    'attempt-create',
    'container-append',
    'receipt-append',
    'code-update',
    'attempt-update',
    'problem-update',
    'receipt-complete',
  ])(
    'recovers a committed %s with a lost response across worker recreation without another page or event',
    async (fault) => {
      const f = fixture();
      expect((await f.connect()).ok).toBe(true);
      const replacement = !['problem-create', 'attempt-create'].includes(fault);
      let retainedPage: string | undefined;
      if (replacement) {
        const seed = await f.send({ op: 'capture.submit', event: captureEvent(0), source });
        expect(seed.ok).toBe(true);
        if (seed.ok) retainedPage = seed.data.completed!.result.attemptPageId;
      }
      const event = captureEvent(replacement ? 1 : 0);
      const original = structuredClone(event);
      f.fail(fault);
      expect((await f.send({ op: 'capture.submit', event, source })).ok).toBe(false);
      expect(f.failed).toBe(true);
      expect(JSON.stringify(f.storage.local.values)).not.toContain('def twoSum');
      expect(JSON.stringify(f.storage.session.values)).not.toContain('def twoSum');
      const callsBeforeRetirement = f.notion.requests.length;
      f.restart();
      const pending = await f.send({ op: 'capture.pending' });
      expect(pending).toMatchObject({
        ok: true,
        data: { connection: { unlocked: true }, pending: { event: original, source } },
      });
      expect(f.notion.requests).toHaveLength(callsBeforeRetirement);
      // A new tab/editor cannot replace the frozen journal, even using another valid UUID.
      expect(
        await f.send({
          op: 'capture.submit',
          event: captureEvent(99),
          source: { tabId: 99, fingerprint: 'new-tab' },
        }),
      ).toMatchObject({ ok: false, code: 'PENDING_CAPTURE' });
      const mutationsBeforeCheck = f.notion.counts.mutations;
      expect(await f.send({ op: 'capture.check', eventId: original.clientEventId })).toMatchObject({
        ok: true,
        data: { pending: { event: original, disposition: 'retry' } },
      });
      expect(f.notion.counts.mutations).toBe(mutationsBeforeCheck);
      const recovered = await f.send({ op: 'capture.retry', eventId: original.clientEventId });
      expect(recovered).toMatchObject({
        ok: true,
        data: {
          pending: null,
          completed: {
            eventId: original.clientEventId,
            source,
            result: { review: { solvedStreak: replacement ? 2 : 1 } },
          },
        },
      });
      if (retainedPage && recovered.ok)
        expect(recovered.data.completed!.result.attemptPageId).toBe(retainedPage);
      const problems = await rows(f.notion, directManifest.problems.dataSourceId);
      const attempts = await rows(f.notion, directManifest.attempts.dataSourceId);
      expect(problems).toHaveLength(1);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].properties['Client Event ID'].rich_text[0].plain_text).toBe(
        original.clientEventId,
      );
      const blocks = await (
        await f.notion.respond(`https://api.notion.com/v1/blocks/${attempts[0].id}/children`)
      ).json();
      const code = blocks.results.find((block: any) => block.type === 'code');
      expect(
        code.code.rich_text.map((item: any) => item.plain_text ?? item.text.content).join(''),
      ).toBe(original.attempt.code);
    },
  );

  it.each([401, 403])(
    'retains the whole capture after a late %i, requires unlock after browser restart, and retries only explicitly',
    async (status) => {
      const f = fixture();
      expect((await f.connect()).ok).toBe(true);
      const event = captureEvent(0);
      f.fail('problem-update', status);
      expect(await f.send({ op: 'capture.submit', event, source })).toMatchObject({
        ok: false,
        code: status === 401 ? 'AUTHENTICATION' : 'PERMISSION',
      });
      expect(f.failed).toBe(true);
      const requests = f.notion.requests.length;
      f.restart(true);
      expect(await f.send({ op: 'connection.state' })).toMatchObject({
        ok: true,
        data: { connection: { unlocked: false, hasPending: true }, pending: null },
      });
      expect(await f.send({ op: 'capture.retry', eventId: event.clientEventId })).toMatchObject({
        ok: false,
        code: 'LOCKED',
      });
      expect(f.notion.requests).toHaveLength(requests);
      expect(await f.send({ op: 'connection.unlock', passphrase })).toMatchObject({
        ok: true,
        data: { pending: { event, source } },
      });
      expect(f.notion.requests).toHaveLength(requests);
      expect(await f.send({ op: 'capture.retry', eventId: event.clientEventId })).toMatchObject({
        ok: true,
        data: {
          pending: null,
          completed: { eventId: event.clientEventId, result: { review: { solvedStreak: 1 } } },
        },
      });
      expect(await rows(f.notion, directManifest.problems.dataSourceId)).toHaveLength(1);
      expect(await rows(f.notion, directManifest.attempts.dataSourceId)).toHaveLength(1);
    },
  );
});
