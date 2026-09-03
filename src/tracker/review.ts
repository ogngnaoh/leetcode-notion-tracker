import type { Difficulty, PracticeState } from '../shared/contract.js';

export interface DashboardRow {
  title: string;
  url: string;
  difficulty: Difficulty;
  practiceState: PracticeState;
  solvedStreak: number;
  nextReview: string;
}

export interface DashboardSnapshot {
  date: string;
  goal: number;
  newProblemCount: number;
  due: DashboardRow[];
  generatedAt: string;
  stale: boolean;
}

interface DashboardStoreOptions {
  goal: number;
  load(
    date: string,
    newProblemSessionStartedAt?: string,
  ): Promise<{ newProblemCount: number; due: DashboardRow[] }>;
  newProblemSessionStartedAt?: string;
  now?: () => Date;
}

export class DashboardStore {
  private snapshot?: DashboardSnapshot;
  private inFlight: Promise<DashboardSnapshot> | undefined;
  private failedDate: string | undefined;
  private readonly now: () => Date;
  private goal: number;
  private newProblemSessionStartedAt: string | undefined;

  constructor(private readonly options: DashboardStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.goal = options.goal;
    this.newProblemSessionStartedAt = options.newProblemSessionStartedAt;
  }

  current(): DashboardSnapshot | undefined {
    return this.snapshot;
  }

  currentGoal(): number {
    return this.goal;
  }

  currentSessionStartedAt(): string | undefined {
    return this.newProblemSessionStartedAt;
  }

  failedFor(date: string): boolean {
    return this.failedDate === date;
  }

  updateGoal(goal: number): void {
    this.goal = goal;
    if (this.snapshot) this.snapshot = { ...this.snapshot, goal };
  }

  updateSessionStartedAt(timestamp: string): void {
    this.newProblemSessionStartedAt = timestamp;
    if (this.snapshot) this.snapshot = { ...this.snapshot, newProblemCount: 0 };
  }

  refresh(date = localDate(this.now())): Promise<DashboardSnapshot> {
    if (this.inFlight) return this.inFlight;
    const load = this.newProblemSessionStartedAt
      ? this.options.load(date, this.newProblemSessionStartedAt)
      : this.options.load(date);
    this.inFlight = load
      .then((loaded) => {
        this.failedDate = undefined;
        this.snapshot = {
          date,
          goal: this.goal,
          newProblemCount: loaded.newProblemCount,
          due: loaded.due,
          generatedAt: this.now().toISOString(),
          stale: false,
        };
        return this.snapshot;
      })
      .catch((error: unknown) => {
        this.failedDate = date;
        if (!this.snapshot) throw error;
        this.snapshot = { ...this.snapshot, stale: true };
        return this.snapshot;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}

export function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
