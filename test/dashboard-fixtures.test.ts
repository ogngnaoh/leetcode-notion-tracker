import { describe, expect, it } from 'vitest';
import { createDashboardFixtureApp, dashboardFixture } from '../src/bridge/dashboard-fixtures.js';

describe('dashboard design fixtures', () => {
  it.each(['normal', 'empty', 'stale', 'loading', 'unavailable'] as const)(
    'renders the %s state through the production renderer',
    (state) => {
      const fixture = dashboardFixture(state);
      expect(fixture.html).toContain('<title>LC Log Daily</title>');
      expect(fixture.html).toContain(fixture.expectedText);
      expect(fixture.html).toContain('id="open-dashboard-settings"');
      expect(fixture.html).toContain('id="dashboard-settings-dialog"');
      expect(fixture.html).toContain('id="daily-new-problem-goal"');
      expect(fixture.html).toContain('NEW PROBLEMS THIS SESSION');
      expect(fixture.html).toContain('id="reset-new-problem-session"');
      expect(fixture.html).not.toContain('NEW SOLVES TODAY');
      if (state === 'normal' || state === 'stale') {
        expect(fixture.html).toContain('data-review-queue');
      }
    },
  );

  it('supports the exact reset response for live interaction inspection', async () => {
    const response = await createDashboardFixtureApp().request('/dashboard/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LC-Dashboard-Token': 'fixture-dashboard-token',
      },
      body: JSON.stringify({ resetNewProblemSession: true }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dailyNewProblemGoal: 10,
      newProblemCount: 0,
    });
  });
});
