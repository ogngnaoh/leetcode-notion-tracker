import 'dotenv/config';
import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { CaptureService } from './capture-service.js';
import { DashboardSettingsStore } from './dashboard-settings.js';
import { readBridgeEnv } from './env.js';
import { NotionCaptureRepository } from './notion-repository.js';
import { DashboardStore } from './dashboard.js';

async function main(): Promise<void> {
  const env = readBridgeEnv();
  const repository = await NotionCaptureRepository.create(
    env.NOTION_TOKEN,
    env.NOTION_MANIFEST_PATH,
  );
  const dashboardSettings = new DashboardSettingsStore({
    path: resolve(process.cwd(), 'build/dashboard-settings.json'),
    fallbackGoal: env.DAILY_NEW_PROBLEM_GOAL,
  });
  const savedSettings = await dashboardSettings.load();
  let currentSettings = savedSettings;
  let settingsQueue = Promise.resolve(savedSettings);
  const updateSettings = (
    transform: (settings: typeof savedSettings) => typeof savedSettings,
  ): Promise<typeof savedSettings> => {
    const operation = settingsQueue
      .catch(() => currentSettings)
      .then(async (settings) => {
        const next = transform(settings);
        await dashboardSettings.save(next);
        currentSettings = next;
        return next;
      });
    settingsQueue = operation;
    return operation;
  };
  const dashboard = new DashboardStore({
    goal: savedSettings.dailyNewProblemGoal,
    ...(savedSettings.newProblemSessionStartedAt
      ? { newProblemSessionStartedAt: savedSettings.newProblemSessionStartedAt }
      : {}),
    load: (date, newProblemSessionStartedAt) =>
      repository.loadDashboard(date, newProblemSessionStartedAt),
  });
  void dashboard.refresh().catch(() => {
    console.error('Dashboard prefetch failed. The dashboard will retry when opened.');
  });
  const app = createApp({
    bridgeToken: env.BRIDGE_TOKEN,
    captureService: new CaptureService(repository),
    dashboard,
    dashboardSettings: {
      antiForgeryToken: randomUUID(),
      saveGoal: (goal) =>
        updateSettings((settings) => ({ ...settings, dailyNewProblemGoal: goal })),
      resetSession: (timestamp) =>
        updateSettings((settings) => ({
          ...settings,
          newProblemSessionStartedAt: timestamp,
        })),
    },
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
