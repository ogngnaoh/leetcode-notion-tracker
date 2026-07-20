import { describe, expect, it } from 'vitest';
import { computeReviewState } from '../src/shared/review.js';

const attemptedAt = '2026-07-20T12:00:00.000Z';

describe('computeReviewState', () => {
  it('resets a red problem and schedules it for the next day', () => {
    expect(computeReviewState(2, 'Red', attemptedAt)).toEqual({
      mastery: 'Red',
      greenCount: 0,
      nextReview: '2026-07-21T12:00:00.000Z',
    });
  });

  it('resets a yellow problem and schedules it two days later', () => {
    expect(computeReviewState(1, 'Yellow', attemptedAt)).toEqual({
      mastery: 'Yellow',
      greenCount: 0,
      nextReview: '2026-07-22T12:00:00.000Z',
    });
  });

  it('schedules the first two green solves before mastery', () => {
    expect(computeReviewState(0, 'Green', attemptedAt)).toEqual({
      mastery: 'Green',
      greenCount: 1,
      nextReview: '2026-07-23T12:00:00.000Z',
    });
    expect(computeReviewState(1, 'Green', attemptedAt)).toEqual({
      mastery: 'Green',
      greenCount: 2,
      nextReview: '2026-07-27T12:00:00.000Z',
    });
  });

  it('marks the third green solve as mastered', () => {
    expect(computeReviewState(2, 'Green', attemptedAt)).toEqual({
      mastery: 'Mastered',
      greenCount: 3,
      nextReview: null,
    });
  });
});
