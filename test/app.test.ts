import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bridge/app.js';
import { CaptureService } from '../src/bridge/capture-service.js';
import { DashboardStore } from '../src/bridge/dashboard.js';
import { MemoryCaptureRepository } from '../src/bridge/memory-repository.js';

const bridgeToken = 'a-very-long-personal-bridge-token';
const dashboardToken = 'per-process-dashboard-token';
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
  const dashboard = new DashboardStore({
    goal: 10,
    load: async () => ({ newProblemCount: 0, due: [] }),
    now: () => new Date('2026-07-21T15:00:00Z'),
  });
  const saveGoal = vi.fn(async (dailyNewProblemGoal: number) => ({ dailyNewProblemGoal }));
  const resetSession = vi.fn(async (newProblemSessionStartedAt: string) => ({
    dailyNewProblemGoal: dashboard.currentGoal(),
    newProblemSessionStartedAt,
  }));
  return {
    repository,
    dashboard,
    saveGoal,
    resetSession,
    app: createApp({
      bridgeToken,
      captureService: new CaptureService(repository),
      dashboard,
      now: () => new Date('2026-07-21T15:00:00.000Z'),
      dashboardSettings: { antiForgeryToken: dashboardToken, saveGoal, resetSession },
    }),
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

  it('serves a public uncached CSP-restricted dashboard without API CORS', async () => {
    const { app } = testApp();
    const response = await app.request('/dashboard?refresh=1', {
      headers: { Origin: 'https://example.com' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).not.toContain("'unsafe-inline'");
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const html = await response.text();
    expect(html).toContain('REVIEWS DUE');
    expect(html).toContain(`<meta name="dashboard-settings-token" content="${dashboardToken}">`);
    expect(html).not.toContain(bridgeToken);
    expect(html).not.toMatch(/ntn_|secret_|Bearer/);
  });

  it('persists a valid dashboard goal before updating the rendered snapshot', async () => {
    const { app, dashboard, saveGoal } = testApp();
    await dashboard.refresh('2026-07-21');

    const response = await app.request('/dashboard/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LC-Dashboard-Token': dashboardToken,
        Origin: 'http://127.0.0.1:8787',
      },
      body: JSON.stringify({ dailyNewProblemGoal: 14 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dailyNewProblemGoal: 14 });
    expect(saveGoal).toHaveBeenCalledWith(14);
    expect(dashboard.current()?.goal).toBe(14);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await (await app.request('/dashboard')).text()).toContain(
      'data-dashboard-goal aria-label="Maximum new problems: 14. Activate to edit.">14</button>',
    );
  });

  it('persists a bridge-timestamped session reset before zeroing only the dashboard count', async () => {
    const { app, dashboard, resetSession } = testApp();
    await dashboard.refresh('2026-07-21');

    const response = await app.request('/dashboard/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LC-Dashboard-Token': dashboardToken,
      },
      body: JSON.stringify({ resetNewProblemSession: true }),
    });

    expect(response.status).toBe(200);
    expect(resetSession).toHaveBeenCalledWith('2026-07-21T15:00:00.000Z');
    expect(await response.json()).toEqual({
      dailyNewProblemGoal: 10,
      newProblemCount: 0,
      newProblemSessionStartedAt: '2026-07-21T15:00:00.000Z',
    });
    expect(dashboard.current()).toMatchObject({ newProblemCount: 0, goal: 10, due: [] });
    expect(dashboard.currentSessionStartedAt()).toBe('2026-07-21T15:00:00.000Z');
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing value', '{}'],
    ['zero', '{"dailyNewProblemGoal":0}'],
    ['over 100', '{"dailyNewProblemGoal":101}'],
    ['fraction', '{"dailyNewProblemGoal":1.5}'],
    ['string', '{"dailyNewProblemGoal":"10"}'],
    ['extra field', '{"dailyNewProblemGoal":10,"other":true}'],
    ['false reset', '{"resetNewProblemSession":false}'],
    [
      'browser timestamp',
      '{"resetNewProblemSession":true,"newProblemSessionStartedAt":"2026-07-21T15:00:00.000Z"}',
    ],
    ['mixed operations', '{"dailyNewProblemGoal":10,"resetNewProblemSession":true}'],
  ])('rejects dashboard settings with %s', async (_description, body) => {
    const { app, saveGoal } = testApp();
    const response = await app.request('/dashboard/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LC-Dashboard-Token': dashboardToken },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid dashboard settings' });
    expect(saveGoal).not.toHaveBeenCalled();
  });

  it.each([undefined, 'wrong-token'])('rejects a %s anti-forgery token', async (token) => {
    const { app, saveGoal } = testApp();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['X-LC-Dashboard-Token'] = token;

    const response = await app.request('/dashboard/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ dailyNewProblemGoal: 14 }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(saveGoal).not.toHaveBeenCalled();
  });

  it('returns a fixed 500 and preserves the previous goal when persistence fails', async () => {
    const repository = new MemoryCaptureRepository();
    const dashboard = new DashboardStore({
      goal: 10,
      load: async () => ({ newProblemCount: 1, due: [] }),
    });
    await dashboard.refresh('2026-07-21');
    const secret = `ntn_${'S'.repeat(30)}`;
    const logger = { error: vi.fn() };
    const app = createApp({
      bridgeToken,
      captureService: new CaptureService(repository),
      dashboard,
      dashboardSettings: {
        antiForgeryToken: dashboardToken,
        saveGoal: vi.fn().mockRejectedValue(new Error(`disk failed ${secret}`)),
        resetSession: vi.fn(),
      },
      logger,
    });

    const response = await app.request('/dashboard/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LC-Dashboard-Token': dashboardToken },
      body: JSON.stringify({ dailyNewProblemGoal: 14 }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Dashboard settings could not be saved.' });
    expect(dashboard.current()?.goal).toBe(10);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
  });

  it('preserves the previous count and boundary when reset persistence fails', async () => {
    const repository = new MemoryCaptureRepository();
    const dashboard = new DashboardStore({
      goal: 10,
      newProblemSessionStartedAt: '2026-07-20T12:00:00.000Z',
      load: async () => ({ newProblemCount: 2, due: [] }),
    });
    await dashboard.refresh('2026-07-21');
    const app = createApp({
      bridgeToken,
      captureService: new CaptureService(repository),
      dashboard,
      now: () => new Date('2026-07-21T15:00:00.000Z'),
      dashboardSettings: {
        antiForgeryToken: dashboardToken,
        saveGoal: vi.fn(),
        resetSession: vi.fn().mockRejectedValue(new Error('disk failed')),
      },
    });

    const response = await app.request('/dashboard/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LC-Dashboard-Token': dashboardToken },
      body: JSON.stringify({ resetNewProblemSession: true }),
    });

    expect(response.status).toBe(500);
    expect(dashboard.current()).toMatchObject({ newProblemCount: 2, goal: 10 });
    expect(dashboard.currentSessionStartedAt()).toBe('2026-07-20T12:00:00.000Z');
  });

  it('revalidates dashboard assets and serves shared nested font paths', async () => {
    const { app } = testApp();
    const css = await app.request('/dashboard-assets/dashboard.css');
    const fontCss = await app.request('/dashboard-assets/fonts/fonts.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('cache-control')).toBe('no-cache');
    expect(fontCss.status).toBe(200);
    expect(fontCss.headers.get('content-type')).toContain('text/css');
  });

  it('returns loading immediately before the first snapshot and refreshes an old local date', async () => {
    let resolveLoad!: (value: { newProblemCount: number; due: [] }) => void;
    const load = vi
      .fn()
      .mockResolvedValueOnce({ newProblemCount: 1, due: [] })
      .mockImplementationOnce(
        () =>
          new Promise<{ newProblemCount: number; due: [] }>((resolve) => {
            resolveLoad = resolve;
          }),
      );
    const dashboard = new DashboardStore({ goal: 10, load });
    await dashboard.refresh('2026-07-20');
    const app = createApp({
      bridgeToken,
      captureService: new CaptureService(new MemoryCaptureRepository()),
      dashboard,
      now: () => new Date('2026-07-21T15:00:00Z'),
    });

    const loading = await app.request('/dashboard');
    expect(await loading.text()).toContain('Loading today’s plan');
    expect(load).toHaveBeenLastCalledWith('2026-07-21');
    resolveLoad({ newProblemCount: 0, due: [] });
    await vi.waitFor(() => expect(dashboard.current()?.date).toBe('2026-07-21'));
  });

  it('refreshes dashboard data after every successful capture including duplicates', async () => {
    const repository = new MemoryCaptureRepository();
    const captureService = new CaptureService(repository);
    const dashboard = new DashboardStore({
      goal: 10,
      load: vi.fn(async () => ({ newProblemCount: 0, due: [] })),
    });
    const refresh = vi.spyOn(dashboard, 'refresh');
    const app = createApp({ bridgeToken, captureService, dashboard });
    const request = () =>
      app.request('/api/capture', {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(2);
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
