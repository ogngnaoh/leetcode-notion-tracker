import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { CaptureEventSchema } from '../shared/contract.js';
import type { CaptureService } from './capture-service.js';

interface AppOptions {
  bridgeToken: string;
  captureService: CaptureService;
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['POST', 'OPTIONS'],
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

  app.post('/api/capture', async (context) => {
    const rawBody: unknown = await context.req.json();
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
      const message = error instanceof Error ? error.message : 'Unknown bridge error';
      console.error('Capture failed:', error);
      return context.json({ error: message }, 500);
    }
  });

  return app;
}
