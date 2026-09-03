import { describe, expect, it, vi } from 'vitest';
import { NotionTransport } from '../extension/src/notion-transport.js';

describe('restricted Notion transport', () => {
  it('rejects non-Notion origins before fetch and strips ambient options', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}'));
    const transport = new NotionTransport({ fetch: fetcher });
    const context = { assertActive() {} };
    await expect(
      transport.request(
        { path: 'https://evil.invalid/v1/pages', method: 'GET' },
        'synthetic',
        context,
      ),
    ).rejects.toThrow();
    await transport.request(
      { path: '/v1/pages/00000000-0000-4000-8000-000000000001', method: 'GET' },
      'synthetic',
      context,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('does not automatically retry mutation failures and persists rate cooldown', async () => {
    let cooldown = 0;
    const fetcher = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'Retry-After': '40' } }),
    );
    const transport = new NotionTransport({
      fetch: fetcher,
      now: () => 1000,
      saveCooldown: async (value) => {
        cooldown = value;
      },
    });
    const response = await transport.request(
      { path: '/v1/pages', method: 'POST', body: '{}' },
      'synthetic',
      { assertActive() {} },
    );
    expect(response.status).toBe(429);
    expect(cooldown).toBe(41000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled response body and never exposes underlying fetch error details', async () => {
    let signal: AbortSignal | null | undefined;
    const transport = new NotionTransport({
      requestTimeoutMs: 5,
      fetch: async (_url, init) => {
        signal = init.signal;
        return new Response(new ReadableStream({ start() {} }));
      },
    });
    await expect(
      transport.request(
        { path: '/v1/pages/00000000-0000-4000-8000-000000000001', method: 'GET' },
        'synthetic',
        { assertActive() {} },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(signal?.aborted).toBe(true);
    const failure = new NotionTransport({
      fetch: async () => {
        throw new Error('private response data');
      },
    });
    await expect(
      failure.request({ path: '/v1/pages', method: 'POST', body: '{}' }, 'synthetic', {
        assertActive() {},
      }),
    ).rejects.not.toThrow('private response data');
  });

  it('honors a persisted cooldown after recreation without making a request or sleeping', async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const sleep = vi.fn(async () => {});
    const transport = new NotionTransport({
      fetch: fetcher,
      now: () => 1000,
      loadCooldown: async () => 41000,
      sleep,
    });
    await expect(
      transport.request(
        { path: '/v1/pages/00000000-0000-4000-8000-000000000001', method: 'GET' },
        'synthetic',
        { assertActive() {} },
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAt: 41000 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('serializes requests and aborts queued work after Lock', async () => {
    let release!: (response: Response) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn(async () => {
      started();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const transport = new NotionTransport({ fetch: fetcher });
    const controller = new AbortController();
    const context = { signal: controller.signal, assertActive() {} };
    const path = '/v1/pages/00000000-0000-4000-8000-000000000001';
    const first = transport.request({ path, method: 'GET' }, 'synthetic', context);
    const second = transport.request({ path, method: 'GET' }, 'synthetic', context);
    const outcome = Promise.allSettled([first, second]);
    await entered;
    expect(fetcher).toHaveBeenCalledTimes(1);
    controller.abort();
    release(Response.json({}));
    expect((await outcome).every((result) => result.status === 'rejected')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds read retries and sends the real SDK through restricted fetch with a fixed version', async () => {
    let now = 0;
    const fetcher = vi.fn(async () =>
      Response.json(
        { object: 'error', code: 'service_unavailable', message: 'unavailable' },
        { status: 503 },
      ),
    );
    const transport = new NotionTransport({
      fetch: fetcher,
      now: () => now,
      sleep: async (delay) => {
        now += delay;
      },
    });
    const client = transport.createClient('synthetic', { assertActive() {} });
    await expect(
      client.pages.retrieve({ page_id: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]).toBeDefined();
  });
});
