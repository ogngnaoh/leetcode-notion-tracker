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
    let resolveLoad!: (value: { newProblemCount: number; due: typeof rows }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ newProblemCount: number; due: typeof rows }>((resolve) => {
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
    resolveLoad({ newProblemCount: 1, due: rows });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    load.mockRejectedValueOnce(new Error('Notion unavailable'));
    const stale = await store.refresh('2026-07-21');
    expect(stale).toMatchObject({ stale: true, newProblemCount: 1, due: rows });
  });

  it('updates the displayed goal immediately without refreshing Notion data', async () => {
    const load = vi.fn(async () => ({ newProblemCount: 1, due: rows }));
    const store = new DashboardStore({
      goal: 10,
      load,
      now: () => new Date('2026-07-21T15:00:00Z'),
    });
    await store.refresh('2026-07-21');

    store.updateGoal(14);

    expect(store.current()).toMatchObject({
      goal: 14,
      newProblemCount: 1,
      due: rows,
      stale: false,
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it('resets only the in-memory session count and passes the boundary to later refreshes', async () => {
    const load = vi.fn(async () => ({ newProblemCount: 3, due: rows }));
    const store = new DashboardStore({
      goal: 10,
      load,
      newProblemSessionStartedAt: '2026-07-21T12:00:00.000Z',
      now: () => new Date('2026-07-22T15:00:00.000Z'),
    });
    await store.refresh('2026-07-22');

    store.updateSessionStartedAt('2026-07-22T15:00:00.000Z');

    expect(store.currentSessionStartedAt()).toBe('2026-07-22T15:00:00.000Z');
    expect(store.current()).toMatchObject({ newProblemCount: 0, due: rows, goal: 10 });
    await store.refresh('2026-07-22');
    expect(load).toHaveBeenLastCalledWith('2026-07-22', '2026-07-22T15:00:00.000Z');
  });

  it('escapes content, rejects unsafe links, omits secrets, and includes focus refresh behavior', () => {
    const html = renderDashboard({
      date: '2026-07-21',
      goal: 10,
      newProblemCount: 1,
      due: [
        {
          ...row,
          difficulty: 'Medium',
          practiceState: 'Needed help',
          nextReview: '2026-07-20',
        },
        row,
        {
          ...row,
          title: 'Unsafe',
          url: 'javascript:alert(1)',
          difficulty: 'Hard',
          practiceState: 'Needed help',
          nextReview: '2026-07-19',
        },
      ],
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
    expect(html).toContain('NEW PROBLEMS THIS SESSION');
    expect(html).toContain('First attempts since your last reset.');
    expect(html).toContain('New-problem session');
    expect(html).toContain('Start a fresh counting session without changing your saved attempts.');
    expect(html).toContain('data-dashboard-new-problem-count>1</strong>');
    expect(html).toContain(
      'data-dashboard-goal aria-label="Maximum new problems: 10. Activate to edit.">10</button>',
    );
    expect(html).toContain(
      'id="daily-new-problem-goal" name="dailyNewProblemGoal" type="number" min="1" max="100" step="1" required value="10"',
    );
    expect(html).toContain(
      '</div><p id="daily-new-problem-goal-error" class="goal-error" role="status" aria-live="polite"></p>',
    );
    expect(html).not.toContain('id="dashboard-settings-form"');
    expect(html).not.toContain('Save maximum');
    expect(html).not.toContain('Maximum new problems</label>');
    expect(html).toContain('id="cancel-dashboard-settings"');
    expect(html).toContain('>Close</button>');
    expect(html).toContain('id="reset-new-problem-session"');
    expect(html).toContain('id="reset-new-problem-session-dialog"');
    expect(html).toContain('Reset the new-problems count to zero?');
    expect(html).toContain('/dashboard-assets/dashboard.css?v=5');
    expect(html).toContain('/dashboard-assets/dashboard.js?v=5');
    expect(html).not.toContain('NEW SOLVES TODAY');
    expect(html).not.toContain('new-solve');
    expect(html).toContain('data-review-queue');
    expect(html).toContain('data-review-search');
    expect(html).toContain('data-review-filter="all"');
    expect(html).toContain('data-review-filter="today"');
    expect(html).toContain('data-review-filter="overdue"');
    expect(html).toContain('data-review-filter="needed-help"');
    expect(html).not.toContain('data-review-filter="hard"');
    expect(html).toContain('data-filter-count="all">3</span>');
    expect(html).toContain('data-filter-count="today">1</span>');
    expect(html).toContain('data-filter-count="overdue">2</span>');
    expect(html).toContain('data-filter-count="needed-help">2</span>');
    expect(html).not.toContain('data-filter-count="hard"');
    expect(html).toContain(
      'data-review-row data-title="&lt;two sum&gt;" data-review-date="2026-07-20" data-practice-state="Needed help" data-difficulty="Medium"',
    );
    expect(html).toContain(
      'data-review-row data-title="&lt;two sum&gt;" data-review-date="2026-07-21" data-practice-state="Solved" data-difficulty="Easy"',
    );
    expect(html).toContain(
      'data-review-row data-title="unsafe" data-review-date="2026-07-19" data-practice-state="Needed help" data-difficulty="Hard"',
    );
    expect(html).toContain('badge badge--hard">Hard</span>');
    expect(html).toContain(
      '<strong>1d overdue</strong> · <time datetime="2026-07-20">2026-07-20</time>',
    );
    expect(html).toContain(
      '<strong>Today</strong> · <time datetime="2026-07-21">2026-07-21</time>',
    );
    expect(html).toContain(
      '<strong>2d overdue</strong> · <time datetime="2026-07-19">2026-07-19</time>',
    );
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('class="cards"');
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
      newProblemCount: 0,
      generatedAt: '2026-07-21T15:00:00.000Z',
      stale: false,
      due: [{ ...row, url: 'https://leetcode.com/problems/two-sum/?env=secret#code' }],
    });
    expect(html).not.toContain('env=secret');
    expect(html).not.toContain('target="_blank"');
  });
});
