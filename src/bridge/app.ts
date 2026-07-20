import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { CaptureEventSchema } from '../shared/contract.js';
import type { CaptureService } from './capture-service.js';

interface AppOptions {
  bridgeToken: string;
  captureService: CaptureService;
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
