import { describe, expect, it } from 'vitest';
import type { AttemptResult } from '../src/shared/contract.js';
import { computeReviewState } from '../src/shared/review.js';

describe('computeReviewState', () => {
  it.each([
    {
      name: 'a helped solve',
      streak: 4,
      result: 'Needed help' as const,
      expected: {
        practiceState: 'Needed help',
        solvedStreak: 0,
        nextReview: '2026-07-20',
      },
    },
    {
      name: 'the first independent solve',
      streak: 0,
      result: 'Solved' as const,
      expected: { practiceState: 'Solved', solvedStreak: 1, nextReview: '2026-07-21' },
    },
    {
      name: 'the second independent solve',
      streak: 1,
      result: 'Solved' as const,
      expected: { practiceState: 'Solved', solvedStreak: 2, nextReview: '2026-07-23' },
    },
    {
      name: 'the third independent solve',
      streak: 2,
      result: 'Solved' as const,
      expected: { practiceState: 'Solved', solvedStreak: 3, nextReview: '2026-07-27' },
    },
    {
      name: 'the fourth independent solve',
      streak: 3,
      result: 'Solved' as const,
      expected: { practiceState: 'Solved', solvedStreak: 4, nextReview: '2026-08-03' },
    },
    {
      name: 'the fifth independent solve',
      streak: 4,
      result: 'Solved' as const,
      expected: { practiceState: 'Mastered', solvedStreak: 5, nextReview: null },
    },
    {
      name: 'a solved attempt after mastery',
      streak: 5,
      result: 'Solved' as const,
      expected: { practiceState: 'Mastered', solvedStreak: 5, nextReview: null },
    },
  ])('computes $name', ({ streak, result, expected }) => {
    expect(computeReviewState(streak, result, '2026-07-20')).toEqual(expected);
  });

  it.each([
    ['month boundary', '2026-01-31', 0, '2026-02-01'],
    ['leap-day boundary', '2028-02-28', 0, '2028-02-29'],
    ['leap-month boundary', '2028-02-29', 1, '2028-03-03'],
    ['year boundary', '2026-12-31', 2, '2027-01-07'],
  ])('uses calendar-date arithmetic across a %s', (_name, attemptedOn, streak, nextReview) => {
    expect(computeReviewState(streak, 'Solved', attemptedOn).nextReview).toBe(nextReview);
  });

  it('resets a solved streak after a helped result', () => {
    expect(computeReviewState(3, 'Needed help', '2026-07-20').solvedStreak).toBe(0);
  });

  it.each([-1, 1.5, 6])('rejects invalid current streak %s', (streak) => {
    expect(() => computeReviewState(streak, 'Solved', '2026-07-20')).toThrow(
      'currentSolvedStreak must be an integer from 0 through 5.',
    );
  });

  it.each(['2026-02-29', '2026-2-01', '2026-01-32', '2026-01-01T12:00:00Z'])(
    'rejects invalid attempted-on date %s',
    (attemptedOn) => {
      expect(() => computeReviewState(0, 'Solved', attemptedOn)).toThrow(
        'attemptedOn must be a valid YYYY-MM-DD calendar date.',
      );
    },
  );

  it('rejects a result outside the public contract at runtime', () => {
    expect(() => computeReviewState(0, 'Green' as AttemptResult, '2026-07-20')).toThrow(
      'result must be Needed help or Solved.',
    );
  });
});
