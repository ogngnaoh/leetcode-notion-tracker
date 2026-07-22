import { describe, expect, it, vi } from 'vitest';
import type { AttemptResult, CaptureEvent, ProblemSnapshot } from '../src/shared/contract.js';
import { CaptureService } from '../src/bridge/capture-service.js';
import { MemoryCaptureRepository } from '../src/bridge/memory-repository.js';
import type { ReviewState } from '../src/shared/contract.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

class BlockingOlderApplyRepository extends MemoryCaptureRepository {
  blockedAttemptedAt: string | null = null;
  readonly olderApplyEntered = deferred<void>();
  readonly releaseOlderApply = deferred<void>();

  override async applyReview(
    problemPageId: string,
    attemptedAt: string,
    review: ReviewState,
  ): Promise<void> {
    if (attemptedAt === this.blockedAttemptedAt) {
      this.olderApplyEntered.resolve();
      await this.releaseOlderApply.promise;
    }
    await super.applyReview(problemPageId, attemptedAt, review);
  }
}

const baseProblem: ProblemSnapshot = {
  slug: 'two-sum',
  title: 'Two Sum',
  number: 1,
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'Easy',
  topics: ['Array', 'Hash Table'],
};

function captureEvent(
  options: {
    clientEventId?: string;
    problem?: ProblemSnapshot;
    attemptedAt?: string;
    attemptedOn?: string;
    result?: AttemptResult;
  } = {},
): CaptureEvent {
  return {
    clientEventId: options.clientEventId ?? 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
    problem: options.problem ?? baseProblem,
    attempt: {
      attemptedAt: options.attemptedAt ?? '2026-07-20T08:00:00-04:00',
      attemptedOn: options.attemptedOn ?? '2026-07-20',
      language: 'Python',
      code: 'def twoSum(nums, target):\n    return []',
      result: options.result ?? 'Solved',
    },
  };
}

describe('CaptureService', () => {
  it('creates a problem and immutable attempt before applying review state', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);

    const result = await service.capture(captureEvent());

    expect(result).toMatchObject({
      duplicate: false,
      review: { practiceState: 'Solved', solvedStreak: 1, nextReview: '2026-07-21' },
    });
    expect(repository.operations).toEqual([
      'createProblem',
      'createAttempt',
      'applyFirstSolved',
      'applyReview',
    ]);
    expect(repository.problems.get('leetcode:two-sum')).toMatchObject({
      ...baseProblem,
      externalKey: 'leetcode:two-sum',
      practiceState: 'Solved',
      solvedStreak: 1,
      nextReview: '2026-07-21',
      lastAttempt: '2026-07-20T08:00:00-04:00',
      firstSolved: '2026-07-20T08:00:00-04:00',
    });
  });

  it('records only the earliest successful solve and ignores failed, helped, and later solves', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    await service.capture(captureEvent({ result: 'Couldn’t solve' }));
    await service.capture(
      captureEvent({
        clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
        attemptedAt: '2026-07-21T08:00:00-04:00',
        attemptedOn: '2026-07-21',
        result: 'Needed help',
      }),
    );
    await service.capture(
      captureEvent({
        clientEventId: 'fd8fa9f0-4f92-4d1b-a4ce-07f93c976a36',
        attemptedAt: '2026-07-22T08:00:00-04:00',
        attemptedOn: '2026-07-22',
        result: 'Solved',
      }),
    );
    await service.capture(
      captureEvent({
        clientEventId: '18cb731b-474c-4d4e-ac3f-aea694cb257f',
        attemptedAt: '2026-07-23T08:00:00-04:00',
        attemptedOn: '2026-07-23',
        result: 'Solved',
      }),
    );

    expect(repository.problems.get('leetcode:two-sum')?.firstSolved).toBe(
      '2026-07-22T08:00:00-04:00',
    );
  });

  it('moves First Solved earlier for an older historical solved attempt', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    await service.capture(
      captureEvent({ attemptedAt: '2026-07-22T08:00:00-04:00', attemptedOn: '2026-07-22' }),
    );
    await service.capture(
      captureEvent({
        clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
        attemptedAt: '2026-07-19T08:00:00-04:00',
        attemptedOn: '2026-07-19',
      }),
    );

    expect(repository.problems.get('leetcode:two-sum')?.firstSolved).toBe(
      '2026-07-19T08:00:00-04:00',
    );
    expect(repository.problems.get('leetcode:two-sum')?.lastAttempt).toBe(
      '2026-07-22T08:00:00-04:00',
    );
  });

  it('repairs a missing First Solved on exact-ID retry without another Attempt', async () => {
    const repository = new MemoryCaptureRepository();
    vi.spyOn(repository, 'applyFirstSolved').mockRejectedValueOnce(
      new Error('First Solved update failed'),
    );
    const service = new CaptureService(repository);
    const capture = captureEvent();

    await expect(service.capture(capture)).rejects.toThrow('First Solved update failed');
    expect(repository.attempts).toHaveLength(1);
    await expect(service.capture(capture)).resolves.toMatchObject({ duplicate: true });
    expect(repository.attempts).toHaveLength(1);
    expect(repository.problems.get('leetcode:two-sum')?.firstSolved).toBe(
      capture.attempt.attemptedAt,
    );
  });

  it('updates canonical metadata from a genuinely new event', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    await service.capture(captureEvent());
    const updatedProblem: ProblemSnapshot = {
      ...baseProblem,
      title: 'Two Sum',
      number: null,
      difficulty: 'Medium',
      topics: ['Array'],
      url: 'https://leetcode.com/problems/two-sum/?envType=daily-question',
    };

    await service.capture(
      captureEvent({
        clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
        problem: updatedProblem,
        attemptedAt: '2026-07-21T08:00:00-04:00',
        attemptedOn: '2026-07-21',
      }),
    );

    expect(repository.problems.get('leetcode:two-sum')).toMatchObject(updatedProblem);
    expect(repository.metadataUpdates).toHaveLength(1);
  });

  it('looks up a duplicate before deriving a key or using incoming metadata', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const original = captureEvent();
    const first = await service.capture(original);
    const poisonedRetry = {
      ...original,
      problem: { ...original.problem, slug: 'INVALID SLUG', title: 'Poisoned retry' },
    } as CaptureEvent;

    const retry = await service.capture(poisonedRetry);

    expect(retry).toEqual({ ...first, duplicate: true });
    expect(repository.problems.get('leetcode:two-sum')?.title).toBe('Two Sum');
    expect(repository.metadataUpdates).toHaveLength(0);
  });

  it('does not rewind a problem when an older duplicate is replayed', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const older = captureEvent({ attemptedAt: '2026-07-20T12:00:00+05:00' });
    await service.capture(older);
    const newer = captureEvent({
      clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
      attemptedAt: '2026-07-20T08:00:00-04:00',
      result: 'Needed help',
    });
    await service.capture(newer);
    const applicationsBeforeRetry = repository.appliedReviews.length;

    await service.capture(older);

    expect(repository.appliedReviews).toHaveLength(applicationsBeforeRetry);
    expect(repository.problems.get('leetcode:two-sum')).toMatchObject({
      practiceState: 'Needed help',
      lastAttempt: newer.attempt.attemptedAt,
    });
  });

  it('stores an older distinct event without rewinding the canonical review state', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const newer = captureEvent({
      attemptedAt: '2026-07-21T08:00:00-04:00',
      attemptedOn: '2026-07-21',
      result: 'Solved',
    });
    await service.capture(newer);
    const applicationsBeforeOlderEvent = repository.appliedReviews.length;

    const older = captureEvent({
      clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
      attemptedAt: '2026-07-20T08:00:00-04:00',
      attemptedOn: '2026-07-20',
      result: 'Couldn’t solve',
    });
    const result = await service.capture(older);

    expect(result).toMatchObject({
      duplicate: false,
      review: { practiceState: 'Solved', solvedStreak: 1, nextReview: '2026-07-22' },
    });
    expect(repository.attempts).toHaveLength(2);
    expect(repository.appliedReviews).toHaveLength(applicationsBeforeOlderEvent);
    expect(repository.problems.get('leetcode:two-sum')).toMatchObject({
      practiceState: 'Solved',
      solvedStreak: 1,
      nextReview: '2026-07-22',
      lastAttempt: newer.attempt.attemptedAt,
    });
  });

  it('repairs a failed final Problem update without creating another Attempt', async () => {
    const repository = new MemoryCaptureRepository();
    const applyReview = vi.spyOn(repository, 'applyReview');
    applyReview.mockRejectedValueOnce(new Error('Problem update failed'));
    const service = new CaptureService(repository);
    const capture = captureEvent();

    await expect(service.capture(capture)).rejects.toThrow('Problem update failed');
    expect(repository.attempts).toHaveLength(1);

    const result = await service.capture(capture);

    expect(result.duplicate).toBe(true);
    expect(repository.attempts).toHaveLength(1);
    expect(repository.problems.get('leetcode:two-sum')).toMatchObject({
      practiceState: 'Solved',
      solvedStreak: 1,
      lastAttempt: capture.attempt.attemptedAt,
    });
  });

  it('coalesces concurrent requests for the same event', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const capture = captureEvent();

    const [first, second] = await Promise.all([service.capture(capture), service.capture(capture)]);

    expect(first).toEqual(second);
    expect(repository.attempts).toHaveLength(1);
  });

  it('serializes distinct simultaneous solves for one Problem without losing a streak', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    await service.capture(captureEvent());

    const [second, third] = await Promise.all([
      service.capture(
        captureEvent({
          clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
          attemptedAt: '2026-07-21T08:00:00-04:00',
          attemptedOn: '2026-07-21',
        }),
      ),
      service.capture(
        captureEvent({
          clientEventId: 'fd8fa9f0-4f92-4d1b-a4ce-07f93c976a36',
          attemptedAt: '2026-07-22T08:00:00-04:00',
          attemptedOn: '2026-07-22',
        }),
      ),
    ]);

    expect([second.review.solvedStreak, third.review.solvedStreak].sort()).toEqual([2, 3]);
    expect(repository.problems.get('leetcode:two-sum')).toMatchObject({ solvedStreak: 3 });
  });

  it('prevents an older duplicate repair from rewinding a newer concurrent apply', async () => {
    const repository = new BlockingOlderApplyRepository();
    const service = new CaptureService(repository);
    const older = captureEvent();
    await service.capture(older);
    repository.blockedAttemptedAt = older.attempt.attemptedAt;

    const duplicate = service.capture(older);
    await repository.olderApplyEntered.promise;
    const newer = service.capture(
      captureEvent({
        clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
        attemptedAt: '2026-07-21T08:00:00-04:00',
        attemptedOn: '2026-07-21',
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    repository.releaseOlderApply.resolve();
    await Promise.all([duplicate, newer]);

    expect(repository.problems.get('leetcode:two-sum')).toMatchObject({
      solvedStreak: 2,
      lastAttempt: '2026-07-21T08:00:00-04:00',
    });
  });

  it('returns exact found and missing problem status values', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    await expect(service.getProblemStatus('missing')).resolves.toEqual({ found: false });
    await service.capture(captureEvent());

    await expect(service.getProblemStatus('two-sum')).resolves.toEqual({
      found: true,
      practiceState: 'Solved',
      solvedStreak: 1,
      nextReview: '2026-07-21',
      lastAttempt: '2026-07-20T08:00:00-04:00',
    });
  });
});
