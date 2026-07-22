import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface DashboardSettings {
  dailyNewProblemGoal: number;
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
  if (Object.keys(record).length !== 1 || !('dailyNewProblemGoal' in record)) {
    throw new Error('Dashboard settings have an unexpected shape.');
  }
  return { dailyNewProblemGoal: parseDailyNewProblemGoal(record.dailyNewProblemGoal) };
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

  save(goal: number): Promise<void> {
    const acceptedGoal = parseDailyNewProblemGoal(goal);
    const operation = this.saveQueue.catch(() => undefined).then(() => this.persist(acceptedGoal));
    this.saveQueue = operation;
    return operation;
  }

  private async persist(goal: number): Promise<void> {
    const directory = dirname(this.options.path);
    const temporaryPath = `${this.options.path}.${process.pid}.${temporaryFileCounter++}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ dailyNewProblemGoal: goal })}\n`, {
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
