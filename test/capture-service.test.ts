import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../src/shared/contract.js';
import { CaptureService } from '../src/bridge/capture-service.js';
import { MemoryCaptureRepository } from '../src/bridge/memory-repository.js';

function event(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
    problem: {
      slug: 'two-sum',
      title: '1. Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
    },
    attempt: {
      attemptedAt: '2026-07-20T12:00:00.000Z',
      language: 'Python',
      submissionResult: 'Accepted',
      outcome: 'Green',
      coldAttempt: true,
      helpUsed: 'None',
      failureCode: null,
      totalMinutes: 12,
      primaryPattern: 'Arrays & Hashing',
      notes: 'Used a hash map in one pass.',
      code: 'def twoSum(nums, target):\n    return []',
    },
    ...overrides,
  };
}

describe('CaptureService', () => {
  it('creates one problem and one attempt, then applies the review state', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);

    const result = await service.capture(event());

    expect(result.duplicate).toBe(false);
    expect(result.review).toEqual({
      mastery: 'Green',
      greenCount: 1,
      nextReview: '2026-07-23T12:00:00.000Z',
    });
    expect(repository.problems).toHaveLength(1);
    expect(repository.attempts).toHaveLength(1);
    expect(repository.appliedReviews).toHaveLength(1);
  });

  it('returns the existing attempt when the same event is retried', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);
    const capture = event();

    const first = await service.capture(capture);
    const second = await service.capture(capture);

    expect(first.attemptPageId).toBe(second.attemptPageId);
    expect(second.duplicate).toBe(true);
    expect(repository.problems).toHaveLength(1);
    expect(repository.attempts).toHaveLength(1);
    expect(repository.appliedReviews).toHaveLength(2);
  });

  it('reaches mastery after three distinct green attempts', async () => {
    const repository = new MemoryCaptureRepository();
    const service = new CaptureService(repository);

    await service.capture(event());
    await service.capture(
      event({
        clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
        attempt: {
          ...event().attempt,
          attemptedAt: '2026-07-24T12:00:00.000Z',
        },
      }),
    );
    const third = await service.capture(
      event({
        clientEventId: 'fd8fa9f0-4f92-4d1b-a4ce-07f93c976a36',
        attempt: {
          ...event().attempt,
          attemptedAt: '2026-08-01T12:00:00.000Z',
        },
      }),
    );

    expect(third.review).toEqual({
      mastery: 'Mastered',
      greenCount: 3,
      nextReview: null,
    });
  });
});
