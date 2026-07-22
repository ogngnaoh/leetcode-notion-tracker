import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CaptureEventSchema } from '../shared/contract.js';
import type { CaptureService } from './capture-service.js';
import { parseDailyNewProblemGoal, type DashboardSettings } from './dashboard-settings.js';
import { localDate, renderDashboard, type DashboardStore } from './dashboard.js';

interface AppOptions {
  bridgeToken: string;
  captureService: CaptureService;
  now?: () => Date;
  dashboard?: DashboardStore;
  dashboardSettings?: {
    antiForgeryToken: string;
    saveGoal(goal: number): Promise<DashboardSettings>;
    resetSession(timestamp: string): Promise<DashboardSettings>;
  };
  logger?: {
    error(message: string, diagnostics: Record<string, unknown>): void;
  };
}

const MAX_ERROR_MESSAGE_LENGTH = 240;

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function redactErrorMessage(error: unknown, bridgeToken: string): string {
  const raw = error instanceof Error ? error.message : 'Unknown bridge error';
  return raw
    .replaceAll(bridgeToken, '[REDACTED_BRIDGE_TOKEN]')
    .replace(/\b(?:ntn_|secret_)[A-Za-z0-9_-]+\b/g, '[REDACTED_NOTION_TOKEN]')
    .replace(/\bBearer\s+[^\s;,]+/gi, 'Bearer [REDACTED]')
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const logger = options.logger ?? console;

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get('/health', (context) =>
    context.json({
      ok: true,
      service: 'leetcode-notion-bridge',
    }),
  );

  app.get('/dashboard', async (context) => {
    const today = localDate(options.now?.());
    let snapshot = options.dashboard?.current();
    let error: string | undefined;
    let state: 'ready' | 'loading' | 'unavailable' = snapshot ? 'ready' : 'unavailable';
    const needsNewDate = snapshot?.date !== undefined && snapshot.date !== today;
    const failedToday = options.dashboard?.failedFor(today) ?? false;
    try {
      if (options.dashboard && context.req.query('refresh') === '1') {
        snapshot = await options.dashboard.refresh(today);
        state = 'ready';
      } else if (options.dashboard && (!snapshot || (needsNewDate && !failedToday))) {
        void options.dashboard.refresh(today).catch(() => undefined);
        snapshot = undefined;
        state = failedToday ? 'unavailable' : 'loading';
      }
    } catch {
      error = 'Notion is unavailable. Use Refresh to try again.';
      snapshot = options.dashboard?.current();
      state = snapshot ? 'ready' : 'unavailable';
    }
    context.header('Cache-Control', 'no-store');
    context.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    context.header('X-Content-Type-Options', 'nosniff');
    return context.html(
      renderDashboard(
        snapshot,
        error,
        state,
        options.dashboardSettings?.antiForgeryToken,
        options.dashboard?.currentGoal(),
      ),
    );
  });

  app.post('/dashboard/settings', async (context) => {
    if (
      !options.dashboardSettings ||
      context.req.header('X-LC-Dashboard-Token') !== options.dashboardSettings.antiForgeryToken
    ) {
      return context.json({ error: 'Forbidden' }, 403);
    }

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid dashboard settings' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return context.json({ error: 'Invalid dashboard settings' }, 400);
    }
    const record = body as Record<string, unknown>;
    const keys = Object.keys(record);
    const updatesGoal = keys.length === 1 && keys[0] === 'dailyNewProblemGoal';
    const resetsSession =
      keys.length === 1 &&
      keys[0] === 'resetNewProblemSession' &&
      record.resetNewProblemSession === true;
    if (!updatesGoal && !resetsSession) {
      return context.json({ error: 'Invalid dashboard settings' }, 400);
    }
    let goal: number | undefined;
    if (updatesGoal) {
      try {
        goal = parseDailyNewProblemGoal(record.dailyNewProblemGoal);
      } catch {
        return context.json({ error: 'Invalid dashboard settings' }, 400);
      }
    }

    try {
      if (updatesGoal) {
        const settings = await options.dashboardSettings.saveGoal(goal as number);
        options.dashboard?.updateGoal(settings.dailyNewProblemGoal);
        return context.json({ dailyNewProblemGoal: settings.dailyNewProblemGoal });
      }

      const timestamp = (options.now?.() ?? new Date()).toISOString();
      const settings = await options.dashboardSettings.resetSession(timestamp);
      options.dashboard?.updateGoal(settings.dailyNewProblemGoal);
      options.dashboard?.updateSessionStartedAt(timestamp);
      return context.json({
        dailyNewProblemGoal: settings.dailyNewProblemGoal,
        newProblemCount: 0,
        newProblemSessionStartedAt: timestamp,
      });
    } catch {
      logger.error('Dashboard settings save failed', {});
      return context.json({ error: 'Dashboard settings could not be saved.' }, 500);
    }
  });

  const dashboardAssets: Record<string, { path: string; type: string }> = {
    'tokens.css': { path: 'extension/vendor/tokens.css', type: 'text/css; charset=utf-8' },
    'components.css': { path: 'extension/vendor/components.css', type: 'text/css; charset=utf-8' },
    'dashboard.css': {
      path: 'src/bridge/assets/dashboard.css',
      type: 'text/css; charset=utf-8',
    },
    'dashboard.js': {
      path: 'src/bridge/assets/dashboard.js',
      type: 'text/javascript; charset=utf-8',
    },
    'fonts/fonts.css': {
      path: 'extension/vendor/fonts/fonts.css',
      type: 'text/css; charset=utf-8',
    },
    'fonts/inter-400.woff2': { path: 'extension/vendor/fonts/inter-400.woff2', type: 'font/woff2' },
    'fonts/inter-500.woff2': { path: 'extension/vendor/fonts/inter-500.woff2', type: 'font/woff2' },
    'fonts/ibm-plex-mono-400.woff2': {
      path: 'extension/vendor/fonts/ibm-plex-mono-400.woff2',
      type: 'font/woff2',
    },
    'square-terminal.svg': { path: 'extension/square-terminal.svg', type: 'image/svg+xml' },
  };
  app.get('/dashboard-assets/*', async (context) => {
    const name = context.req.path.slice('/dashboard-assets/'.length);
    const asset = dashboardAssets[name];
    if (!asset) return context.notFound();
    context.header('Content-Type', asset.type);
    context.header('Cache-Control', 'no-cache');
    return context.body(await readFile(resolve(process.cwd(), asset.path)));
  });

  app.use('/api/*', async (context, next) => {
    const expected = `Bearer ${options.bridgeToken}`;
    if (context.req.header('Authorization') !== expected) {
      return context.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  app.get('/api/problems/:slug/status', async (context) => {
    const slug = context.req.param('slug');
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return context.json({ error: 'Invalid problem slug' }, 400);
    }
    try {
      return context.json(await options.captureService.getProblemStatus(slug));
    } catch (error) {
      logger.error('Problem status failed', {
        problemSlug: slug,
        errorName: error instanceof Error ? error.name : typeof error,
        errorStatus: errorStatus(error),
        errorMessage: redactErrorMessage(error, options.bridgeToken),
      });
      return context.json(
        { error: 'Problem status failed. Check the local bridge terminal.' },
        500,
      );
    }
  });

  app.post('/api/capture', async (context) => {
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid capture event' }, 400);
    }
    const parsed = CaptureEventSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid capture event',
          issues: parsed.error.issues,
        },
        400,
      );
    }

    try {
      const result = await options.captureService.capture(parsed.data);
      void options.dashboard?.refresh().catch(() => undefined);
      return context.json(result, result.duplicate ? 200 : 201);
    } catch (error) {
      logger.error('Capture failed', {
        clientEventId: parsed.data.clientEventId,
        problemSlug: parsed.data.problem.slug,
        errorName: error instanceof Error ? error.name : typeof error,
        errorStatus: errorStatus(error),
        errorMessage: redactErrorMessage(error, options.bridgeToken),
      });
      return context.json(
        {
          error: 'Capture failed. Check the local bridge terminal and run npm run notion:verify.',
        },
        500,
      );
    }
  });

  return app;
}
