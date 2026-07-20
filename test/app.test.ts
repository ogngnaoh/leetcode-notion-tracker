import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bridge/app.js';
import { CaptureService } from '../src/bridge/capture-service.js';
import { MemoryCaptureRepository } from '../src/bridge/memory-repository.js';

const bridgeToken = 'a-very-long-personal-bridge-token';
const payload = {
  clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
  problem: {
    slug: 'two-sum',
    title: 'Two Sum',
    number: 1,
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
    topics: ['Array', 'Hash Table'],
  },
  attempt: {
    attemptedAt: '2026-07-20T08:30:00-04:00',
    attemptedOn: '2026-07-20',
    language: 'Python',
    code: 'def twoSum(nums, target):\n    return []',
    result: 'Solved',
  },
};

function testApp(repository = new MemoryCaptureRepository()) {
  return {
    repository,
    app: createApp({ bridgeToken, captureService: new CaptureService(repository) }),
  };
}

const authorization = { Authorization: `Bearer ${bridgeToken}` };

describe('bridge app', () => {
  it('exposes an unauthenticated health endpoint', async () => {
    const { app } = testApp();
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'leetcode-notion-bridge' });
  });

  it.each([
    ['POST', '/api/capture'],
    ['GET', '/api/problems/two-sum/status'],
  ])('requires bearer authentication for %s %s', async (method, path) => {
    const { app } = testApp();
    const response = await app.request(path, { method });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns exact missing and found problem status unions', async () => {
    const { app } = testApp();
    const missing = await app.request('/api/problems/missing/status', { headers: authorization });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ found: false });

    await app.request('/api/capture', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const found = await app.request('/api/problems/two-sum/status', { headers: authorization });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({
      found: true,
      practiceState: 'Solved',
      solvedStreak: 1,
      nextReview: '2026-07-21',
      lastAttempt: '2026-07-20T08:30:00-04:00',
    });
  });

  it('rejects a URL-decoded value that is not a LeetCode slug', async () => {
    const { app } = testApp();
    const response = await app.request('/api/problems/two%20sum/status', {
      headers: authorization,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid problem slug' });
  });

  it('permits GET through CORS preflight and exposes CORS headers on status', async () => {
    const { app } = testApp();
    const preflight = await app.request('/api/problems/two-sum/status', {
      method: 'OPTIONS',
      headers: {
        Origin: 'chrome-extension://tracker',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('GET');

    const response = await app.request('/api/problems/two-sum/status', {
      headers: { ...authorization, Origin: 'chrome-extension://tracker' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('accepts a valid v2 capture with the bridge token', async () => {
    const { app } = testApp();
    const response = await app.request('/api/capture', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      duplicate: false,
      review: { practiceState: 'Solved', solvedStreak: 1, nextReview: '2026-07-21' },
    });
  });

  it('rejects malformed JSON and legacy capture fields', async () => {
    const { app } = testApp();
    const malformed = await app.request('/api/capture', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid capture event' });

    const legacy = structuredClone(payload) as any;
    legacy.attempt.outcome = 'Green';
    const rejected = await app.request('/api/capture', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(legacy),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: 'Invalid capture event' });
  });

  it('returns a fixed message and logs only bounded redacted diagnostics on failure', async () => {
    const repository = new MemoryCaptureRepository();
    const captureService = new CaptureService(repository);
    const notionToken = 'ntn_' + 'A'.repeat(24);
    const bridgeSecret = 'personal-' + 'B'.repeat(24);
    const failure = Object.assign(
      new Error(
        `Notion rejected ${notionToken}; Authorization: Bearer ${bridgeSecret}; ${'x'.repeat(1_000)}`,
      ),
      { status: 502 },
    );
    vi.spyOn(captureService, 'capture').mockRejectedValue(failure);
    const logger = { error: vi.fn() };
    const app = createApp({ bridgeToken, captureService, logger });

    const response = await app.request('/api/capture', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Capture failed. Check the local bridge terminal and run npm run notion:verify.',
    });
    const logged = JSON.stringify(logger.error.mock.calls[0]);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logged).not.toContain(notionToken);
    expect(logged).not.toContain(bridgeSecret);
    expect(logged.length).toBeLessThan(700);
  });
});
