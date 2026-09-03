import { describe, expect, it } from 'vitest';
import { NotionRuntime } from '../extension/src/notion-runtime.js';
import type { VaultStorageArea } from '../extension/src/notion-vault.js';
import type {
  NotionOperation,
  NotionResponse,
  NotionChanged,
} from '../extension/src/notion-protocol.js';
import { captureEvent } from '../scripts/benchmark/fixture.js';
import { DirectSyntheticNotion, directManifest } from '../scripts/benchmark/direct-fixture.js';

function area(): VaultStorageArea & { values: Record<string, unknown>; failSet: boolean } {
  return {
    values: {},
    failSet: false,
    async get(keys) {
      const selected =
        keys === null ? Object.keys(this.values) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(
        Object.fromEntries(
          selected.filter((key) => key in this.values).map((key) => [key, this.values[key]]),
        ),
      );
    },
    async set(values) {
      if (this.failSet) throw new Error('synthetic storage error');
      Object.assign(this.values, structuredClone(values));
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    },
    async setAccessLevel() {},
  };
}
const passphrase = 'four independent synthetic words';
const source = { tabId: 12, fingerprint: 'synthetic-source' };
function fixture() {
  const storage = { local: area(), session: area() };
  const notion = new DirectSyntheticNotion();
  let now = Date.now();
  const notifications: NotionChanged[] = [];
  const runtime = new NotionRuntime(storage, {
    fetch: (url, init) => notion.respond(url, init),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    changed: (message) => {
      notifications.push(message);
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
      token: 'synthetic-runtime-credential',
      passphrase,
    });
  return { runtime, storage, notion, send, connect, notifications };
}

describe('Notion runtime coordination', () => {
  it('connects read-only, keeps Daily independent and returns private data only unlocked', async () => {
    const { connect, send, storage } = fixture();
    storage.local.values.dailyReps = { goal: 7 };
    expect(await connect()).toMatchObject({
      ok: true,
      data: { connection: { unlocked: true }, pending: null },
    });
    expect(JSON.stringify(storage.local.values)).not.toContain('synthetic-runtime-credential');
    expect(await send({ op: 'connection.lock' })).toMatchObject({
      ok: true,
      data: { connection: { unlocked: false }, preferences: null, pending: null, review: null },
    });
    expect(storage.local.values.dailyReps).toEqual({ goal: 7 });
    expect(await send({ op: 'problem.status', slug: 'two-sum' })).toMatchObject({
      ok: false,
      code: 'LOCKED',
    });
  });
  it('retains completion after a lost UI reply and rejects reused UUID with changed body', async () => {
    const { connect, send } = fixture();
    expect((await connect()).ok).toBe(true);
    const event = captureEvent(0);
    expect(await send({ op: 'capture.submit', event, source })).toMatchObject({
      ok: true,
      data: {
        pending: null,
        completed: { eventId: event.clientEventId, result: { duplicate: false } },
      },
    });
    expect(await send({ op: 'capture.pending' })).toMatchObject({
      ok: true,
      data: { completed: { eventId: event.clientEventId } },
    });
    expect(
      await send({
        op: 'capture.submit',
        event: { ...event, attempt: { ...event.attempt, code: 'different code' } },
        source,
      }),
    ).toMatchObject({ ok: false, code: 'EVENT_CONFLICT' });
  });
  it('refuses forged senders and persistence failure before a capture can dispatch', async () => {
    const { runtime, connect, send, storage } = fixture();
    expect(
      await runtime.handle(
        { type: 'lctrack.notion', version: 1, id: 'fake', op: 'connection.state' },
        { id: 'test', url: 'https://leetcode.com/problems/two-sum/' },
        'test',
      ),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await connect();
    storage.local.failSet = true;
    expect(await send({ op: 'capture.submit', event: captureEvent(0), source })).toMatchObject({
      ok: false,
      code: 'STORAGE_FAILURE',
    });
    storage.local.failSet = false;
    expect(await send({ op: 'capture.pending' })).toMatchObject({
      ok: true,
      data: { pending: null, completed: null },
    });
  });
  it('does not acknowledge Lock before an already-started private cache write is purged', async () => {
    const { connect, send, storage } = fixture();
    await connect();
    let started!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const set = storage.session.set.bind(storage.session);
    storage.session.set = async (values) => {
      if ('lctrack.notion.private.review.v1' in values) {
        started();
        await blocked;
      }
      await set(values);
    };
    const reviewing = send({ op: 'review.refresh' });
    await writing;
    const locking = send({ op: 'connection.lock' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    expect(await locking).toMatchObject({
      ok: true,
      data: { connection: { unlocked: false }, review: null },
    });
    expect(await reviewing).toMatchObject({ ok: false, code: 'LOCKED' });
    expect(
      Object.keys(storage.session.values).filter((key) =>
        key.startsWith('lctrack.notion.private.'),
      ),
    ).toEqual([]);
  });
  it('keeps a completed save successful and rejects its old cache even if cache cleanup fails', async () => {
    const { connect, send, storage } = fixture();
    await connect();
    expect(await send({ op: 'review.read' })).toMatchObject({
      ok: true,
      data: { review: { newProblemCount: 0, stale: false } },
    });
    const remove = storage.session.remove.bind(storage.session);
    storage.session.remove = async (keys) => {
      if (keys === 'lctrack.notion.private.review.v1')
        throw new Error('synthetic cache cleanup failure');
      await remove(keys);
    };
    const event = captureEvent(0);
    expect(await send({ op: 'capture.submit', event, source })).toMatchObject({
      ok: true,
      data: { completed: { eventId: event.clientEventId }, review: null },
    });
    expect(await send({ op: 'connection.state' })).toMatchObject({
      ok: true,
      data: { review: null },
    });
  });
  it('rejects malformed checkpoint records before they enter encrypted runtime state', async () => {
    const { runtime, connect } = fixture();
    await connect();
    await expect(
      runtime.vault.update((data) => ({
        ...data,
        pending: {
          event: captureEvent(0),
          source,
          bodyDigest: '0'.repeat(64),
          state: 'prepared',
          disposition: 'retry',
          createdAt: new Date().toISOString(),
          dispatched: true,
          checkpoints: [null] as never,
        },
      })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('fences an old private state read after new preferences commit', async () => {
    const { connect, storage, notion } = fixture();
    await connect();
    const retired = new NotionRuntime(storage, { fetch: notion.respond });
    const send = (op: NotionOperation) =>
      retired.handle(
        { type: 'lctrack.notion', version: 1, id: crypto.randomUUID(), ...op },
        { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
        'test',
      );
    let started!: () => void;
    let release!: () => void;
    let hold = true;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const get = storage.session.get.bind(storage.session);
    storage.session.get = async (keys) => {
      const value = await get(keys);
      if (keys === 'lctrack.notion.private.review.v1' && hold) {
        hold = false;
        started();
        await blocked;
      }
      return value;
    };
    const oldState = send({ op: 'connection.state' });
    await reading;
    expect(await send({ op: 'preferences.setGoal', goal: 21 })).toMatchObject({
      ok: true,
      data: { preferences: { dailyNewProblemGoal: 21 } },
    });
    release();
    expect(await oldState).toMatchObject({ ok: false, code: 'STALE_STATE' });
  });
  it('allows explicit reset of a damaged vault while preserving the reconciliation requirement', async () => {
    const { storage, send } = fixture();
    storage.local.values['lctrack.notion.vault.v1'] = { format: 'damaged-synthetic-root' };
    expect(await send({ op: 'connection.state' })).toMatchObject({
      ok: false,
      code: 'INVALID_VAULT',
    });
    expect(await send({ op: 'connection.disconnect', confirmUncertain: true })).toMatchObject({
      ok: true,
      data: { connection: { configured: false, reconciliationRequired: true } },
    });
    expect(storage.local.values['lctrack.notion.vault.v1']).toBeUndefined();
  });
  it.each([false, true])(
    'rejects delayed hydration across fresh/stale Review publication (failure=%s)',
    async (fail) => {
      const { connect, send, storage, notion } = fixture();
      await connect();
      await send({ op: 'review.read' });
      const cached = storage.session.values['lctrack.notion.private.review.v1'] as {
        snapshot: { stale: boolean; generatedAt: string };
      };
      cached.snapshot.stale = !fail;
      cached.snapshot.generatedAt = '2000-01-01T00:00:00.000Z';
      const runtime = new NotionRuntime(storage, { fetch: notion.respond });
      const rpc = (op: NotionOperation) =>
        runtime.handle(
          { type: 'lctrack.notion', version: 1, id: crypto.randomUUID(), ...op },
          { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
          'test',
        );
      let start!: () => void;
      let release!: () => void;
      let hold = true;
      const reading = new Promise<void>((resolve) => {
        start = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const get = storage.session.get.bind(storage.session);
      storage.session.get = async (keys) => {
        const value = await get(keys);
        if (keys === 'lctrack.notion.private.review.v1' && hold) {
          hold = false;
          start();
          await blocked;
        }
        return value;
      };
      const oldState = rpc({ op: 'connection.state' });
      await reading;
      if (fail)
        notion.beforeRequest = () =>
          Response.json(
            { object: 'error', status: 401, code: 'unauthorized', message: 'synthetic' },
            { status: 401 },
          );
      expect(await rpc({ op: 'review.refresh' })).toMatchObject(
        fail
          ? { ok: false, code: 'AUTHENTICATION' }
          : { ok: true, data: { review: { stale: false } } },
      );
      release();
      expect(await oldState).toMatchObject({ ok: false, code: 'STALE_STATE' });
      expect(await rpc({ op: 'connection.state' })).toMatchObject({
        ok: true,
        data: { review: { stale: fail } },
      });
    },
  );
  it('orders private replies across worker retirement without resetting their revision', async () => {
    const { connect, send, storage, notion } = fixture();
    const initial = await connect();
    const changed = await send({ op: 'preferences.setGoal', goal: 33 });
    if (!initial.ok || !changed.ok) throw new Error('Synthetic connection failed.');
    expect(changed.data.stateRevision).toBeGreaterThan(initial.data.stateRevision);
    const retired = new NotionRuntime(storage, { fetch: notion.respond });
    const state = await retired.handle(
      { type: 'lctrack.notion', version: 1, id: 'retired', op: 'connection.state' },
      { id: 'test', url: 'chrome-extension://test/sidepanel.html' },
      'test',
    );
    expect(state).toMatchObject({
      ok: true,
      data: { stateRevision: changed.data.stateRevision, preferences: { dailyNewProblemGoal: 33 } },
    });
  });
  it.each([
    { readsFail: false, revisionFails: true },
    { readsFail: true, revisionFails: true },
    { readsFail: true, revisionFails: false },
  ])(
    'preserves Lock failure and broadcasts revoked authority during storage failure ($readsFail/$revisionFails)',
    async ({ readsFail, revisionFails }) => {
      const { connect, send, storage, notifications } = fixture();
      await connect();
      const before = notifications.at(-1)!.connection.generation;
      notifications.length = 0;
      storage.local.failSet = true;
      storage.session.failSet = revisionFails;
      if (readsFail)
        storage.local.get = async () => {
          throw new Error('synthetic read failure');
        };
      storage.session.remove = async () => {
        throw new Error('synthetic removal failure');
      };
      expect(await send({ op: 'connection.lock' })).toMatchObject({
        ok: false,
        code: 'LOCK_FAILED',
      });
      expect(notifications.at(-1)?.connection).toMatchObject({ unlocked: false, lockFailed: true });
      expect(notifications.at(-1)?.connection.generation).not.toBe(before);
    },
  );
});
