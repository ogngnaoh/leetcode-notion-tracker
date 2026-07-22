import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DashboardSettingsStore,
  parseDailyNewProblemGoal,
} from '../src/bridge/dashboard-settings.js';

const temporaryDirectories: string[] = [];

async function temporarySettingsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lc-dashboard-settings-'));
  temporaryDirectories.push(directory);
  return join(directory, 'dashboard-settings.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('dashboard settings', () => {
  it('uses the environment-derived fallback when no saved file exists', async () => {
    const path = await temporarySettingsPath();
    const store = new DashboardSettingsStore({ path, fallbackGoal: 7 });

    await expect(store.load()).resolves.toEqual({ dailyNewProblemGoal: 7 });
  });

  it('reloads a valid saved goal', async () => {
    const path = await temporarySettingsPath();
    await writeFile(path, '{"dailyNewProblemGoal":12}\n', 'utf8');

    const store = new DashboardSettingsStore({ path, fallbackGoal: 7 });
    await expect(store.load()).resolves.toEqual({ dailyNewProblemGoal: 12 });
  });

  it('falls back with one bounded warning when the saved file is malformed', async () => {
    const path = await temporarySettingsPath();
    await writeFile(path, `{"dailyNewProblemGoal":"${'secret'.repeat(100)}"}`, 'utf8');
    const logger = { warn: vi.fn() };

    const store = new DashboardSettingsStore({ path, fallbackGoal: 7, logger });

    await expect(store.load()).resolves.toEqual({ dailyNewProblemGoal: 7 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0].length).toBeLessThanOrEqual(200);
    expect(logger.warn.mock.calls[0]?.[0]).not.toContain('secret');
  });

  it.each([1, 100])('accepts boundary goal %s', (goal) => {
    expect(parseDailyNewProblemGoal(goal)).toBe(goal);
  });

  it.each([0, 101, 1.5, '10', null])('rejects invalid goal %j', (goal) => {
    expect(() => parseDailyNewProblemGoal(goal)).toThrow('integer from 1 through 100');
  });

  it('persists atomically without leaving a temporary file', async () => {
    const path = await temporarySettingsPath();
    const store = new DashboardSettingsStore({ path, fallbackGoal: 10 });

    await store.save(18);

    await expect(readFile(path, 'utf8')).resolves.toBe('{"dailyNewProblemGoal":18}\n');
    await expect(readdir(join(path, '..'))).resolves.toEqual(['dashboard-settings.json']);
  });

  it('serializes concurrent saves so the last accepted request wins', async () => {
    const path = await temporarySettingsPath();
    const store = new DashboardSettingsStore({ path, fallbackGoal: 10 });

    await Promise.all([store.save(4), store.save(19), store.save(31)]);

    await expect(store.load()).resolves.toEqual({ dailyNewProblemGoal: 31 });
  });
});
