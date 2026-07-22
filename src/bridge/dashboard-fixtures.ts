import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { renderDashboard, type DashboardRow, type DashboardSnapshot } from './dashboard.js';

export type DashboardFixtureName =
  'normal' | 'empty' | 'stale' | 'loading' | 'unavailable' | 'large';

const normal: DashboardSnapshot = {
  date: '2026-07-21',
  goal: 10,
  newProblemCount: 1,
  generatedAt: '2026-07-21T19:38:00-04:00',
  stale: false,
  due: [
    {
      title: 'Median of Two Sorted Arrays',
      url: 'https://leetcode.com/problems/median-of-two-sorted-arrays/',
      difficulty: 'Hard',
      practiceState: 'Needed help',
      solvedStreak: 0,
      nextReview: '2026-07-19',
    },
    {
      title: 'Encode and Decode Strings',
      url: 'https://leetcode.com/problems/encode-and-decode-strings/',
      difficulty: 'Medium',
      practiceState: 'Needed help',
      solvedStreak: 0,
      nextReview: '2026-07-20',
    },
    {
      title: 'Two Sum',
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      practiceState: 'Solved',
      solvedStreak: 2,
      nextReview: '2026-07-21',
    },
  ],
};

const largeRows: DashboardRow[] = Array.from({ length: 123 }, (_, index) => ({
  title: `Review Problem ${String(index + 1).padStart(3, '0')}`,
  url: `https://leetcode.com/problems/review-problem-${index + 1}/`,
  difficulty: index % 5 === 0 ? 'Hard' : index % 2 === 0 ? 'Medium' : 'Easy',
  practiceState: index % 3 === 0 ? 'Needed help' : 'Solved',
  solvedStreak: index % 5,
  nextReview: index % 4 === 0 ? '2026-07-21' : '2026-07-20',
}));

const large: DashboardSnapshot = {
  ...normal,
  due: largeRows,
};

export function dashboardFixture(name: DashboardFixtureName): {
  html: string;
  expectedText: string;
} {
  if (name === 'loading')
    return {
      html: renderDashboard(undefined, undefined, 'loading', 'fixture-dashboard-token', 10),
      expectedText: 'Loading today’s plan',
    };
  if (name === 'unavailable')
    return {
      html: renderDashboard(
        undefined,
        'Notion could not be reached.',
        'unavailable',
        'fixture-dashboard-token',
        10,
      ),
      expectedText: 'Dashboard unavailable',
    };
  if (name === 'empty')
    return {
      html: renderDashboard(
        { ...normal, newProblemCount: 0, due: [] },
        undefined,
        'ready',
        'fixture-dashboard-token',
        10,
      ),
      expectedText: 'All caught up',
    };
  if (name === 'stale')
    return {
      html: renderDashboard(
        { ...normal, stale: true },
        undefined,
        'ready',
        'fixture-dashboard-token',
        10,
      ),
      expectedText: 'Saved data',
    };
  if (name === 'large')
    return {
      html: renderDashboard(large, undefined, 'ready', 'fixture-dashboard-token', 10),
      expectedText: 'Review Problem 001',
    };
  return {
    html: renderDashboard(normal, undefined, 'ready', 'fixture-dashboard-token', 10),
    expectedText: 'Encode and Decode Strings',
  };
}

const assets: Record<string, { path: string; type: string }> = {
  'tokens.css': { path: 'extension/vendor/tokens.css', type: 'text/css; charset=utf-8' },
  'components.css': { path: 'extension/vendor/components.css', type: 'text/css; charset=utf-8' },
  'dashboard.css': { path: 'src/bridge/assets/dashboard.css', type: 'text/css; charset=utf-8' },
  'dashboard.js': {
    path: 'src/bridge/assets/dashboard.js',
    type: 'text/javascript; charset=utf-8',
  },
  'fonts/fonts.css': { path: 'extension/vendor/fonts/fonts.css', type: 'text/css; charset=utf-8' },
  'fonts/inter-400.woff2': { path: 'extension/vendor/fonts/inter-400.woff2', type: 'font/woff2' },
  'fonts/inter-500.woff2': { path: 'extension/vendor/fonts/inter-500.woff2', type: 'font/woff2' },
  'fonts/ibm-plex-mono-400.woff2': {
    path: 'extension/vendor/fonts/ibm-plex-mono-400.woff2',
    type: 'font/woff2',
  },
  'square-terminal.svg': { path: 'extension/square-terminal.svg', type: 'image/svg+xml' },
};

export function createDashboardFixtureApp(): Hono {
  const app = new Hono();
  app.get('/dashboard/:state', (context) => {
    const state = context.req.param('state') as DashboardFixtureName;
    if (!['normal', 'empty', 'stale', 'loading', 'unavailable', 'large'].includes(state))
      return context.notFound();
    context.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    return context.html(dashboardFixture(state).html);
  });
  app.get('/dashboard-assets/*', async (context) => {
    const asset = assets[context.req.path.slice('/dashboard-assets/'.length)];
    if (!asset) return context.notFound();
    context.header('Content-Type', asset.type);
    context.header('Cache-Control', 'no-cache');
    return context.body(await readFile(resolve(process.cwd(), asset.path)));
  });
  return app;
}
