import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_CHANNEL,
  createModelRequester,
  createModelResponder,
  listenForModelChanges,
  publishModelChanged,
  type ChannelWindow,
  type MessageEventLike,
} from '../extension/src/leetcode-model-channel.js';

afterEach(() => {
  vi.useRealTimers();
});

class FakeWindow implements ChannelWindow {
  readonly sent: unknown[] = [];
  private listeners = new Set<(event: MessageEventLike) => void>();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEventLike) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEventLike) => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  deliver(data: unknown, source: unknown = this): void {
    for (const listener of [...this.listeners]) listener({ data, source });
  }
}

const reading = { code: 'class Solution:', languageId: 'python3' };

describe('model requester', () => {
  it('posts a request carrying the channel and a fresh id', async () => {
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1');
    const pending = request();
    expect(win.sent).toEqual([{ channel: MODEL_CHANNEL, kind: 'request', id: 'id-1' }]);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading });
    await expect(pending).resolves.toEqual(reading);
  });

  it('resolves null when the responder reports no model', async () => {
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1');
    const pending = request();
    win.deliver({ channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading: null });
    await expect(pending).resolves.toBeNull();
  });

  it('removes its listener once settled', async () => {
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1');
    const pending = request();
    expect(win.listenerCount).toBe(1);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading });
    await pending;
    expect(win.listenerCount).toBe(0);
  });

  it('resolves null after the timeout when nothing replies', async () => {
    vi.useFakeTimers();
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1', 500);
    const pending = request();
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
    expect(win.listenerCount).toBe(0);
  });

  it.each([
    ['a foreign source', { channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading }, {}],
    ['a mismatched id', { channel: MODEL_CHANNEL, kind: 'response', id: 'other', reading }, null],
    ['a foreign channel', { channel: 'evil', kind: 'response', id: 'id-1', reading }, null],
    ['a non-object payload', 'nonsense', null],
    [
      'a malformed reading',
      { channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading: { code: 5 } },
      null,
    ],
  ])('ignores %s', async (_label, data, source) => {
    vi.useFakeTimers();
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1', 500);
    const pending = request();
    win.deliver(data, source === null ? win : source);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
  });
});

describe('model responder', () => {
  it('replies to a request with the current reading', () => {
    const win = new FakeWindow();
    createModelResponder(win, 'https://leetcode.com', () => reading);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'request', id: 'id-9' });
    expect(win.sent).toEqual([{ channel: MODEL_CHANNEL, kind: 'response', id: 'id-9', reading }]);
  });

  it('replies with a null reading when no model is readable', () => {
    const win = new FakeWindow();
    createModelResponder(win, 'https://leetcode.com', () => null);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'request', id: 'id-9' });
    expect(win.sent).toEqual([
      { channel: MODEL_CHANNEL, kind: 'response', id: 'id-9', reading: null },
    ]);
  });

  it.each([
    ['a response message', { channel: MODEL_CHANNEL, kind: 'response', id: 'x', reading: null }],
    ['a foreign channel', { channel: 'evil', kind: 'request', id: 'x' }],
    ['a request without an id', { channel: MODEL_CHANNEL, kind: 'request' }],
  ])('does not reply to %s', (_label, data) => {
    const win = new FakeWindow();
    createModelResponder(win, 'https://leetcode.com', () => reading);
    win.deliver(data);
    expect(win.sent).toEqual([]);
  });

  it('stops replying once disposed', () => {
    const win = new FakeWindow();
    const dispose = createModelResponder(win, 'https://leetcode.com', () => reading);
    dispose();
    win.deliver({ channel: MODEL_CHANNEL, kind: 'request', id: 'id-9' });
    expect(win.sent).toEqual([]);
  });
});

describe('change notifications', () => {
  it('publishes a changed message', () => {
    const win = new FakeWindow();
    publishModelChanged(win, 'https://leetcode.com');
    expect(win.sent).toEqual([{ channel: MODEL_CHANNEL, kind: 'changed' }]);
  });

  it('invokes the callback for a changed message from this window', () => {
    const win = new FakeWindow();
    const onChange = vi.fn();
    listenForModelChanges(win, onChange);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'changed' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a foreign source', { channel: MODEL_CHANNEL, kind: 'changed' }, {}],
    ['a foreign channel', { channel: 'evil', kind: 'changed' }, null],
    ['another kind', { channel: MODEL_CHANNEL, kind: 'request', id: 'x' }, null],
  ])('ignores %s', (_label, data, source) => {
    const win = new FakeWindow();
    const onChange = vi.fn();
    listenForModelChanges(win, onChange);
    win.deliver(data, source === null ? win : source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops listening once disposed', () => {
    const win = new FakeWindow();
    const onChange = vi.fn();
    listenForModelChanges(win, onChange)();
    win.deliver({ channel: MODEL_CHANNEL, kind: 'changed' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
