import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface DashboardSettings {
  dailyNewProblemGoal: number;
  newProblemSessionStartedAt?: string;
}

interface DashboardSettingsStoreOptions {
  path: string;
  fallbackGoal: number;
  logger?: { warn(message: string): void };
}

let temporaryFileCounter = 0;

export function parseDailyNewProblemGoal(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new Error('dailyNewProblemGoal must be an integer from 1 through 100.');
  }
  return value as number;
}

function parseSettings(value: unknown): DashboardSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Dashboard settings must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    !('dailyNewProblemGoal' in record) ||
    keys.some((key) => key !== 'dailyNewProblemGoal' && key !== 'newProblemSessionStartedAt')
  ) {
    throw new Error('Dashboard settings have an unexpected shape.');
  }
  const settings: DashboardSettings = {
    dailyNewProblemGoal: parseDailyNewProblemGoal(record.dailyNewProblemGoal),
  };
  if ('newProblemSessionStartedAt' in record) {
    const timestamp = record.newProblemSessionStartedAt;
    if (
      typeof timestamp !== 'string' ||
      Number.isNaN(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString() !== timestamp
    ) {
      throw new Error('newProblemSessionStartedAt must be a canonical ISO timestamp.');
    }
    settings.newProblemSessionStartedAt = timestamp;
  }
  return settings;
}

export class DashboardSettingsStore {
  private saveQueue: Promise<void> = Promise.resolve();
  private readonly logger: { warn(message: string): void };

  constructor(private readonly options: DashboardSettingsStoreOptions) {
    parseDailyNewProblemGoal(options.fallbackGoal);
    this.logger = options.logger ?? console;
  }

  async load(): Promise<DashboardSettings> {
    try {
      return parseSettings(JSON.parse(await readFile(this.options.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { dailyNewProblemGoal: this.options.fallbackGoal };
      }
      this.logger.warn(
        'Dashboard settings could not be read; using DAILY_NEW_PROBLEM_GOAL for this bridge run.',
      );
      return { dailyNewProblemGoal: this.options.fallbackGoal };
    }
  }

  save(settings: DashboardSettings): Promise<void> {
    const acceptedSettings = parseSettings(settings);
    const operation = this.saveQueue
      .catch(() => undefined)
      .then(() => this.persist(acceptedSettings));
    this.saveQueue = operation;
    return operation;
  }

  private async persist(settings: DashboardSettings): Promise<void> {
    const directory = dirname(this.options.path);
    const temporaryPath = `${this.options.path}.${process.pid}.${temporaryFileCounter++}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(settings)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryPath, this.options.path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
