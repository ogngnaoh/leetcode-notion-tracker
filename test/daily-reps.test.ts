import { describe, expect, it, vi } from 'vitest';
import {
  DAILY_REPS_STORAGE_KEY,
  DailyRepsError,
  DailyRepsStore,
  currentDailySessionStartedAt,
  isDailySessionStale,
  type DailyRepsStateV1,
  type DailyRepsStorageArea,
} from '../extension/src/daily-reps.js';

function problem(slug = 'two-sum') {
  return {
    slug,
    title: slug === 'two-sum' ? 'Two Sum' : 'Valid Anagram',
    number: slug === 'two-sum' ? 1 : 242,
    url: `https://leetcode.com/problems/${slug}/`,
    difficulty: 'Easy' as const,
    topics: ['Array', 'Hash Table'],
  };
}

class MemoryStorage implements DailyRepsStorageArea {
  value: unknown;
  failWrites = false;

  async get(key: string): Promise<Record<string, unknown>> {
    return this.value === undefined ? {} : { [key]: structuredClone(this.value) };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failWrites) throw new Error('QUOTA_BYTES exceeded');
    this.value = structuredClone(items[DAILY_REPS_STORAGE_KEY]);
  }
}

function harness(options: { storage?: MemoryStorage; times?: string[] } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const times = [...(options.times ?? ['2026-08-28T01:00:00.000Z'])];
  let id = 0;
  const store = new DailyRepsStore(storage, {
    randomUUID: () => `id-${++id}`,
    now: () => new Date(times.shift() ?? '2026-08-28T01:00:00.000Z'),
  });
  return { storage, store };
}

describe('DailyRepsStore', () => {
  it('starts without a goal and accepts only an integer goal from 1 through 100', async () => {
    const { store } = harness();

    await expect(store.read()).resolves.toEqual({
      version: 1,
      goal: null,
      currentReps: [],
      archivedSessions: [],
    });
    await expect(store.setGoal(0)).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(store.setGoal(101)).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(store.setGoal(2.5)).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(store.setGoal(4)).resolves.toMatchObject({ goal: 4 });
  });

  it('requires a goal and records every click as a distinct repetition', async () => {
    const { store } = harness({
      times: ['2026-08-28T01:00:00.000Z', '2026-08-28T01:05:00.000Z'],
    });

    await expect(store.logRep(problem())).rejects.toMatchObject({ code: 'GOAL_REQUIRED' });
    await store.setGoal(2);
    await store.logRep(problem());
    const state = await store.logRep(problem());

    expect(state.currentReps).toHaveLength(2);
    expect(state.currentReps.map((rep) => rep.id)).toEqual(['id-1', 'id-2']);
    expect(state.currentReps.map((rep) => rep.problem.slug)).toEqual(['two-sum', 'two-sum']);
  });

  it('removes any current rep and recalculates progress from the retained entries', async () => {
    const { store } = harness({
      times: ['2026-08-28T01:00:00.000Z', '2026-08-28T01:05:00.000Z'],
    });
    await store.setGoal(3);
    await store.logRep(problem());
    const logged = await store.logRep(problem('valid-anagram'));

    const state = await store.removeCurrentRep(logged.currentReps[0]!.id);

    expect(state.currentReps.map((rep) => rep.problem.slug)).toEqual(['valid-anagram']);
  });

  it('archives a below-goal session, snapshots its goal, and carries the goal forward', async () => {
    const { store } = harness({
      times: ['2026-08-27T23:55:00.000Z', '2026-08-28T00:10:00.000Z'],
    });
    await store.setGoal(5);
    await store.logRep(problem());

    const state = await store.finishSession();

    expect(state).toMatchObject({ goal: 5, currentReps: [] });
    expect(state.archivedSessions).toEqual([
      {
        id: 'id-2',
        startedAt: '2026-08-27T23:55:00.000Z',
        endedAt: '2026-08-28T00:10:00.000Z',
        goal: 5,
        reps: [expect.objectContaining({ id: 'id-1' })],
      },
    ]);
    await expect(store.finishSession()).rejects.toMatchObject({ code: 'EMPTY_SESSION' });
  });

  it('deletes an archived session without making archived reps editable', async () => {
    const { store } = harness({
      times: ['2026-08-28T01:00:00.000Z', '2026-08-28T02:00:00.000Z'],
    });
    await store.setGoal(1);
    await store.logRep(problem());
    const archived = await store.finishSession();

    const state = await store.deleteArchivedSession(archived.archivedSessions[0]!.id);

    expect(state.archivedSessions).toEqual([]);
  });

  it('serializes concurrent writes so no repetition is lost', async () => {
    const storage = new MemoryStorage();
    let releaseFirstWrite!: () => void;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const originalSet = storage.set.bind(storage);
    let writes = 0;
    storage.set = vi.fn(async (items) => {
      writes += 1;
      if (writes === 2) await firstWriteBlocked;
      await originalSet(items);
    });
    const { store } = harness({
      storage,
      times: ['2026-08-28T01:00:00.000Z', '2026-08-28T01:01:00.000Z'],
    });
    await store.setGoal(2);

    const first = store.logRep(problem());
    const second = store.logRep(problem('valid-anagram'));
    releaseFirstWrite();
    await Promise.all([first, second]);

    await expect(store.read()).resolves.toMatchObject({
      currentReps: [{ problem: { slug: 'two-sum' } }, { problem: { slug: 'valid-anagram' } }],
    });
  });

  it('does not overwrite malformed stored history', async () => {
    const storage = new MemoryStorage();
    storage.value = { version: 1, goal: 3, currentReps: 'broken', archivedSessions: [] };
    const { store } = harness({ storage });

    await expect(store.read()).rejects.toEqual(
      expect.objectContaining<Partial<DailyRepsError>>({ code: 'CORRUPT_STATE' }),
    );
    await expect(store.setGoal(4)).rejects.toMatchObject({ code: 'CORRUPT_STATE' });
    expect(storage.value).toEqual({
      version: 1,
      goal: 3,
      currentReps: 'broken',
      archivedSessions: [],
    });
  });

  it('surfaces failed persistence without changing the stored state', async () => {
    const { storage, store } = harness();
    await store.setGoal(2);
    const before = structuredClone(storage.value) as DailyRepsStateV1;
    storage.failWrites = true;

    await expect(store.logRep(problem())).rejects.toThrow('QUOTA_BYTES exceeded');
    expect(storage.value).toEqual(before);
  });

  it('derives the active start and warns across local calendar days without resetting', async () => {
    const startedAt = new Date(2026, 7, 27, 23, 30).toISOString();
    const { store } = harness({ times: [startedAt] });
    await store.setGoal(3);
    const state = await store.logRep(problem());

    expect(currentDailySessionStartedAt(state)).toBe(startedAt);
    expect(isDailySessionStale(state, new Date(2026, 7, 28, 1))).toBe(true);
    await expect(store.read()).resolves.toMatchObject({ currentReps: [{ id: 'id-1' }] });
  });
});
