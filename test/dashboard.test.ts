import { describe, expect, it, vi } from 'vitest';
import { DashboardStore, renderDashboard } from '../src/bridge/dashboard.js';

const row = {
  title: '<Two Sum>',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'Easy' as const,
  practiceState: 'Solved' as const,
  solvedStreak: 2,
  nextReview: '2026-07-21',
};
const rows = [row];

describe('local dashboard', () => {
  it('coalesces concurrent forced refreshes and retains a visibly stale snapshot on failure', async () => {
    let resolveLoad!: (value: { newSolveCount: number; due: typeof rows }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ newSolveCount: number; due: typeof rows }>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const store = new DashboardStore({
      goal: 10,
      load,
      now: () => new Date('2026-07-21T15:00:00Z'),
    });
    const first = store.refresh('2026-07-21');
    const second = store.refresh('2026-07-21');
    expect(load).toHaveBeenCalledOnce();
    resolveLoad({ newSolveCount: 1, due: rows });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    load.mockRejectedValueOnce(new Error('Notion unavailable'));
    const stale = await store.refresh('2026-07-21');
    expect(stale).toMatchObject({ stale: true, newSolveCount: 1, due: rows });
  });

  it('updates the displayed goal immediately without refreshing Notion data', async () => {
    const load = vi.fn(async () => ({ newSolveCount: 1, due: rows }));
    const store = new DashboardStore({
      goal: 10,
      load,
      now: () => new Date('2026-07-21T15:00:00Z'),
    });
    await store.refresh('2026-07-21');

    store.updateGoal(14);

    expect(store.current()).toMatchObject({ goal: 14, newSolveCount: 1, due: rows, stale: false });
    expect(load).toHaveBeenCalledOnce();
  });

  it('escapes content, rejects unsafe links, omits secrets, and includes focus refresh behavior', () => {
    const html = renderDashboard({
      date: '2026-07-21',
      goal: 10,
      newSolveCount: 1,
      due: [...rows, { ...row, title: 'Unsafe', url: 'javascript:alert(1)' }],
      generatedAt: '2026-07-21T15:00:00.000Z',
      stale: false,
    });
    expect(html).toContain('&lt;Two Sum&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="/dashboard?refresh=1"');
    expect(html).toContain('/dashboard-assets/dashboard.js');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<style>');
    expect(html).not.toMatch(/ntn_|secret_|Bearer|BRIDGE_TOKEN/);
  });

  it('renders deliberate loading and unavailable states', () => {
    expect(renderDashboard(undefined, undefined, 'loading')).toContain('Loading today’s plan');
    expect(renderDashboard(undefined, 'Notion is unavailable.', 'unavailable')).toContain(
      'Dashboard unavailable',
    );
  });

  it('rejects LeetCode links with query strings or fragments', () => {
    const html = renderDashboard({
      date: '2026-07-21',
      goal: 10,
      newSolveCount: 0,
      generatedAt: '2026-07-21T15:00:00.000Z',
      stale: false,
      due: [{ ...row, url: 'https://leetcode.com/problems/two-sum/?env=secret#code' }],
    });
    expect(html).not.toContain('env=secret');
    expect(html).not.toContain('target="_blank"');
  });
});
