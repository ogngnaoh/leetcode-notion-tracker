import type { Difficulty, ProblemSnapshot } from '../../src/shared/contract.js';

export const DAILY_REPS_STORAGE_KEY = 'leetcodeTracker.dailyReps.v1';

export interface DailyRepProblem {
  slug: string;
  title: string;
  number: number | null;
  url: string;
  difficulty: Difficulty;
  topics: string[];
}

export interface DailyRep {
  id: string;
  loggedAt: string;
  problem: DailyRepProblem;
}

export interface ArchivedRepSession {
  id: string;
  startedAt: string;
  endedAt: string;
  goal: number;
  reps: DailyRep[];
}

export interface DailyRepsStateV1 {
  version: 1;
  goal: number | null;
  currentReps: DailyRep[];
  archivedSessions: ArchivedRepSession[];
}

export interface DailyRepsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface DailyRepsStoreDependencies {
  randomUUID(): string;
  now(): Date;
}

export type DailyRepsRequest =
  | { type: 'DAILY_REPS'; action: 'read' }
  | { type: 'DAILY_REPS'; action: 'set-goal'; goal: number }
  | { type: 'DAILY_REPS'; action: 'log-rep'; problem: DailyRepProblem }
  | { type: 'DAILY_REPS'; action: 'remove-current-rep'; repId: string }
  | { type: 'DAILY_REPS'; action: 'finish-session' }
  | { type: 'DAILY_REPS'; action: 'delete-archived-session'; sessionId: string };

export type DailyRepsResponse =
  | { ok: true; state: DailyRepsStateV1 }
  | { ok: false; code: DailyRepsErrorCode | 'FORBIDDEN' | 'STORAGE_ERROR'; message: string };

export type DailyRepsErrorCode =
  | 'CORRUPT_STATE'
  | 'EMPTY_SESSION'
  | 'GOAL_REQUIRED'
  | 'INVALID_GOAL'
  | 'INVALID_PROBLEM'
  | 'NOT_FOUND';

export class DailyRepsError extends Error {
  constructor(
    message: string,
    readonly code: DailyRepsErrorCode,
  ) {
    super(message);
    this.name = 'DailyRepsError';
  }
}

export function isDailyRepsRequest(value: unknown): value is DailyRepsRequest {
  if (!isRecord(value) || value.type !== 'DAILY_REPS' || typeof value.action !== 'string') {
    return false;
  }
  switch (value.action) {
    case 'read':
    case 'finish-session':
      return true;
    case 'set-goal':
      return typeof value.goal === 'number';
    case 'log-rep':
      return isDailyRepProblem(value.problem);
    case 'remove-current-rep':
      return isBoundedString(value.repId, 200);
    case 'delete-archived-session':
      return isBoundedString(value.sessionId, 200);
    default:
      return false;
  }
}

export async function dispatchDailyRepsRequest(
  store: DailyRepsStore,
  request: DailyRepsRequest,
): Promise<DailyRepsStateV1> {
  switch (request.action) {
    case 'read':
      return store.read();
    case 'set-goal':
      return store.setGoal(request.goal);
    case 'log-rep':
      return store.logRep(request.problem);
    case 'remove-current-rep':
      return store.removeCurrentRep(request.repId);
    case 'finish-session':
      return store.finishSession();
    case 'delete-archived-session':
      return store.deleteArchivedSession(request.sessionId);
  }
}

export function dailyRepsErrorResponse(error: unknown): DailyRepsResponse {
  if (error instanceof DailyRepsError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return {
    ok: false,
    code: 'STORAGE_ERROR',
    message: 'Daily Reps could not be saved. Your previous history is unchanged.',
  };
}

const DIFFICULTIES = new Set<Difficulty>(['Easy', 'Medium', 'Hard', 'Unknown']);
const INITIAL_STATE: DailyRepsStateV1 = {
  version: 1,
  goal: null,
  currentReps: [],
  archivedSessions: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isGoal(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 100;
}

export function isDailyRepProblem(value: unknown): value is DailyRepProblem {
  if (!isRecord(value)) return false;
  if (
    !isBoundedString(value.slug, 200) ||
    !/^[a-z0-9-]+$/.test(value.slug) ||
    !isBoundedString(value.title, 500) ||
    (value.number !== null &&
      !(typeof value.number === 'number' && Number.isInteger(value.number) && value.number > 0)) ||
    value.url !== `https://leetcode.com/problems/${value.slug}/` ||
    typeof value.difficulty !== 'string' ||
    !DIFFICULTIES.has(value.difficulty as Difficulty) ||
    !Array.isArray(value.topics) ||
    value.topics.length > 100
  ) {
    return false;
  }
  return value.topics.every((topic) => isBoundedString(topic, 200));
}

function isDailyRep(value: unknown): value is DailyRep {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 200) &&
    isIsoTimestamp(value.loggedAt) &&
    isDailyRepProblem(value.problem)
  );
}

function isArchivedSession(value: unknown): value is ArchivedRepSession {
  return (
    isRecord(value) &&
    isBoundedString(value.id, 200) &&
    isIsoTimestamp(value.startedAt) &&
    isIsoTimestamp(value.endedAt) &&
    value.startedAt <= value.endedAt &&
    isGoal(value.goal) &&
    Array.isArray(value.reps) &&
    value.reps.length > 0 &&
    value.reps.every(isDailyRep)
  );
}

export function isDailyRepsState(value: unknown): value is DailyRepsStateV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    (value.goal === null || isGoal(value.goal)) &&
    Array.isArray(value.currentReps) &&
    value.currentReps.every(isDailyRep) &&
    Array.isArray(value.archivedSessions) &&
    value.archivedSessions.every(isArchivedSession)
  );
}

function cloneState(state: DailyRepsStateV1): DailyRepsStateV1 {
  return structuredClone(state);
}

function localCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentDailySessionStartedAt(state: DailyRepsStateV1): string | null {
  return state.currentReps.reduce<string | null>(
    (value, rep) => (value === null || rep.loggedAt < value ? rep.loggedAt : value),
    null,
  );
}

export function isDailySessionStale(state: DailyRepsStateV1, now: Date): boolean {
  const startedAt = currentDailySessionStartedAt(state);
  return startedAt !== null && localCalendarDate(new Date(startedAt)) !== localCalendarDate(now);
}

function copyProblem(problem: DailyRepProblem | ProblemSnapshot): DailyRepProblem {
  return {
    slug: problem.slug,
    title: problem.title,
    number: problem.number ?? null,
    url: problem.url,
    difficulty: problem.difficulty,
    topics: [...problem.topics],
  };
}

export class DailyRepsStore {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: DailyRepsStorageArea,
    private readonly dependencies: DailyRepsStoreDependencies,
  ) {}

  read(): Promise<DailyRepsStateV1> {
    return this.serialize(() => this.load());
  }

  setGoal(goal: number): Promise<DailyRepsStateV1> {
    return this.mutate((state) => {
      if (!isGoal(goal)) {
        throw new DailyRepsError('Choose a whole-number goal from 1 through 100.', 'INVALID_GOAL');
      }
      return { ...state, goal };
    });
  }

  logRep(problem: DailyRepProblem | ProblemSnapshot): Promise<DailyRepsStateV1> {
    return this.mutate((state) => {
      if (state.goal === null) {
        throw new DailyRepsError('Set a daily goal before logging a repetition.', 'GOAL_REQUIRED');
      }
      if (!isDailyRepProblem(problem)) {
        throw new DailyRepsError(
          'The active LeetCode problem could not be validated.',
          'INVALID_PROBLEM',
        );
      }
      const rep: DailyRep = {
        id: this.dependencies.randomUUID(),
        loggedAt: this.nowIso(),
        problem: copyProblem(problem),
      };
      return { ...state, currentReps: [...state.currentReps, rep] };
    });
  }

  removeCurrentRep(repId: string): Promise<DailyRepsStateV1> {
    return this.mutate((state) => {
      const retained = state.currentReps.filter((rep) => rep.id !== repId);
      if (retained.length === state.currentReps.length) {
        throw new DailyRepsError(
          'That repetition is no longer in the current session.',
          'NOT_FOUND',
        );
      }
      return { ...state, currentReps: retained };
    });
  }

  finishSession(): Promise<DailyRepsStateV1> {
    return this.mutate((state) => {
      if (state.goal === null) {
        throw new DailyRepsError('Set a daily goal before finishing the session.', 'GOAL_REQUIRED');
      }
      if (state.currentReps.length === 0) {
        throw new DailyRepsError('Log at least one repetition before finishing.', 'EMPTY_SESSION');
      }
      const startedAt = currentDailySessionStartedAt(state)!;
      const session: ArchivedRepSession = {
        id: this.dependencies.randomUUID(),
        startedAt,
        endedAt: this.nowIso(),
        goal: state.goal,
        reps: state.currentReps,
      };
      return {
        ...state,
        currentReps: [],
        archivedSessions: [session, ...state.archivedSessions],
      };
    });
  }

  deleteArchivedSession(sessionId: string): Promise<DailyRepsStateV1> {
    return this.mutate((state) => {
      const retained = state.archivedSessions.filter((session) => session.id !== sessionId);
      if (retained.length === state.archivedSessions.length) {
        throw new DailyRepsError('That archived session no longer exists.', 'NOT_FOUND');
      }
      return { ...state, archivedSessions: retained };
    });
  }

  private mutate(update: (state: DailyRepsStateV1) => DailyRepsStateV1): Promise<DailyRepsStateV1> {
    return this.serialize(async () => {
      const current = await this.load();
      const next = update(current);
      await this.storage.set({ [DAILY_REPS_STORAGE_KEY]: next });
      return cloneState(next);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<DailyRepsStateV1> {
    const values = await this.storage.get(DAILY_REPS_STORAGE_KEY);
    const stored = values[DAILY_REPS_STORAGE_KEY];
    if (stored === undefined) return cloneState(INITIAL_STATE);
    if (!isDailyRepsState(stored)) {
      throw new DailyRepsError(
        'Stored Daily Reps history could not be read. It was left unchanged.',
        'CORRUPT_STATE',
      );
    }
    return cloneState(stored);
  }

  private nowIso(): string {
    const value = this.dependencies.now();
    if (Number.isNaN(value.valueOf())) throw new Error('A valid current time is required.');
    return value.toISOString();
  }
}
