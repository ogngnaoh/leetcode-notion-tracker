import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AvailableLeetCodeSnapshot,
  LeetCodeSnapshot,
} from '../extension/src/leetcode-extraction.js';
import {
  ContextChangePublisher,
  GET_LEETCODE_CONTEXT_MESSAGE,
  GET_LEETCODE_MODEL_MESSAGE,
  createContentMessageHandler,
  type ContentScriptResponse,
} from '../extension/src/leetcode-context-runtime.js';

function unavailable(slug: string): LeetCodeSnapshot {
  return {
    codeAvailable: false,
    problem: {
      slug,
      title: slug,
      number: null,
      url: `https://leetcode.com/problems/${slug}/`,
      difficulty: 'Unknown',
      topics: [],
    },
    language: 'Unknown',
    codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
    fingerprint: null,
  };
}

function available(slug: string, fingerprint: string): LeetCodeSnapshot {
  return {
    codeAvailable: true,
    problem: {
      slug,
      title: slug,
      number: null,
      url: `https://leetcode.com/problems/${slug}/`,
      difficulty: 'Unknown',
      topics: [],
    },
    language: 'TypeScript',
    code: 'code',
    fingerprint,
  };
}

async function request(
  handler: ReturnType<typeof createContentMessageHandler>,
): Promise<ContentScriptResponse> {
  return await new Promise((resolve) => {
    expect(handler({ type: GET_LEETCODE_CONTEXT_MESSAGE }, resolve)).toBe(true);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('content-script context runtime', () => {
  it('never publishes captured code or its fingerprint and permits explicit model invalidation', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const publisher = new ContextChangePublisher(
      async () => available('two-sum', 'private'),
      publish,
      10,
    );
    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    expect(publish.mock.calls[0]?.[0]).not.toHaveProperty('code');
    expect(publish.mock.calls[0]?.[0].fingerprint).toBeNull();
    publisher.notifyChange(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('performs a fresh extraction for every GET_LEETCODE_CONTEXT request', async () => {
    let calls = 0;
    const handler = createContentMessageHandler(async () => {
      calls += 1;
      return unavailable(`problem-${calls}`);
    });

    expect((await request(handler)).context?.problem.slug).toBe('problem-1');
    expect((await request(handler)).context?.problem.slug).toBe('problem-2');
    expect(calls).toBe(2);
  });

  it('requests a full model only with the explicit V4 model operation', async () => {
    const metadata = vi.fn(async () => unavailable('two-sum'));
    const model = vi.fn(async () => available('two-sum', 'private'));
    const handler = createContentMessageHandler(metadata, model);
    await request(handler);
    expect(model).not.toHaveBeenCalled();
    const response = await new Promise<ContentScriptResponse>((resolve) => {
      expect(handler({ type: GET_LEETCODE_MODEL_MESSAGE }, resolve)).toBe(true);
    });
    expect(response.context).toHaveProperty('code', 'code');
    expect(handler({ type: 'GET_LEETCODE_CONTEXT_V3' }, vi.fn())).toBe(false);
  });

  it('ignores unrelated messages without extracting', () => {
    const extract = vi.fn(async () => unavailable('two-sum'));
    const handler = createContentMessageHandler(extract);

    expect(handler({ type: 'OTHER' }, vi.fn())).toBe(false);
    expect(extract).not.toHaveBeenCalled();
  });

  it('ignores the old extraction protocol after an extension reload', () => {
    const extract = vi.fn(async () => unavailable('two-sum'));
    const handler = createContentMessageHandler(extract);

    expect(handler({ type: 'GET_LEETCODE_CONTEXT_V2' }, vi.fn())).toBe(false);
    expect(extract).not.toHaveBeenCalled();
  });

  it('publishes without waiting for continuous page animations to stop', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const publisher = new ContextChangePublisher(async () => unavailable('two-sum'), publish, 25);

    for (let elapsed = 0; elapsed < 600; elapsed += 10) {
      publisher.notifyChange();
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(publish).toHaveBeenCalledWith(unavailable('two-sum'));
    publisher.dispose();
  });

  it('deduplicates metadata until explicitly invalidated after a model edit', async () => {
    vi.useFakeTimers();
    let current = available('two-sum', 'first');
    const published: LeetCodeSnapshot[] = [];
    const publisher = new ContextChangePublisher(
      async () => current,
      (context) => {
        if (context) published.push(context);
      },
      25,
    );

    publisher.notifyChange();
    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(25);
    expect(published.map((item) => item.fingerprint)).toEqual([null]);

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(25);
    expect(published).toHaveLength(1);

    current = available('two-sum', 'second');
    publisher.notifyChange(true);
    await vi.advanceTimersByTimeAsync(25);
    expect(published.map((item) => item.fingerprint)).toEqual([null, null]);
  });

  it('publishes metadata changes alongside an edited code fingerprint', async () => {
    vi.useFakeTimers();
    let current = available('two-sum', 'same') as AvailableLeetCodeSnapshot;
    const published: LeetCodeSnapshot[] = [];
    const publisher = new ContextChangePublisher(
      async () => current,
      (context) => {
        if (context) published.push(context);
      },
      10,
    );

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    current = {
      ...current,
      problem: { ...current.problem, topics: ['Array', 'Hash Table'] },
      code: 'edited = True',
      fingerprint: 'edited-fingerprint',
    };
    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);

    expect(published).toHaveLength(2);
    expect(published[1]).toMatchObject({
      problem: { topics: ['Array', 'Hash Table'] },
      codeAvailable: false,
      fingerprint: null,
    });
    expect(published[1]).not.toHaveProperty('code');
  });

  it('publishes SPA slug changes even while code remains unavailable', async () => {
    vi.useFakeTimers();
    let current = unavailable('two-sum');
    const published: LeetCodeSnapshot[] = [];
    const publisher = new ContextChangePublisher(
      async () => current,
      (context) => {
        if (context) published.push(context);
      },
      10,
    );

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    current = unavailable('three-sum');
    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);

    expect(published.map((item) => item.problem.slug)).toEqual(['two-sum', 'three-sum']);
  });

  it('publishes model invalidations without code availability disclosure', async () => {
    vi.useFakeTimers();
    let current = unavailable('two-sum');
    const published: LeetCodeSnapshot[] = [];
    const publisher = new ContextChangePublisher(
      async () => current,
      (context) => {
        if (context) published.push(context);
      },
      10,
    );

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    current = available('two-sum', 'fingerprint');
    publisher.notifyChange(true);
    await vi.advanceTimersByTimeAsync(10);
    current = unavailable('two-sum');
    publisher.notifyChange(true);
    await vi.advanceTimersByTimeAsync(10);

    expect(published.map((item) => item.codeAvailable)).toEqual([false, false, false]);
  });

  it('does not publish an older extraction after a newer change was requested', async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: LeetCodeSnapshot) => void;
    const old = new Promise<LeetCodeSnapshot>((resolve) => {
      resolveOld = resolve;
    });
    const extract = vi
      .fn<() => Promise<LeetCodeSnapshot | null>>()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(available('three-sum', 'new'));
    const published: LeetCodeSnapshot[] = [];
    const publisher = new ContextChangePublisher(
      extract,
      (context) => {
        if (context) published.push(context);
      },
      10,
    );

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    resolveOld(available('two-sum', 'old'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(published.map((item) => item.problem.slug)).toEqual(['three-sum']);
  });

  it('serializes extraction while publication is pending and suppresses the queued duplicate', async () => {
    vi.useFakeTimers();
    let finishPublish!: () => void;
    const extract = vi.fn(async () => available('two-sum', 'same'));
    const publish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPublish = resolve;
        }),
    );
    const publisher = new ContextChangePublisher(extract, publish, 10);

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    expect(extract).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();

    publisher.notifyChange();
    await vi.advanceTimersByTimeAsync(10);
    expect(extract).toHaveBeenCalledOnce();

    finishPublish();
    await Promise.resolve();
    await Promise.resolve();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledOnce();
  });
});
