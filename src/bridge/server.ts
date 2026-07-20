import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { CaptureService } from './capture-service.js';
import { readBridgeEnv } from './env.js';
import { NotionCaptureRepository } from './notion-repository.js';

async function main(): Promise<void> {
  const env = readBridgeEnv();
  const repository = await NotionCaptureRepository.create(
    env.NOTION_TOKEN,
    env.NOTION_MANIFEST_PATH,
  );
  const app = createApp({
    bridgeToken: env.BRIDGE_TOKEN,
    captureService: new CaptureService(repository),
  });

  serve({
    fetch: app.fetch,
    port: env.PORT,
    hostname: '127.0.0.1',
  });
  console.log(`LeetCode Notion bridge listening on http://127.0.0.1:${env.PORT}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
