import type { Mastery, Outcome, ReviewState } from './contract.js';

const GREEN_REVIEW_DAYS = [3, 7] as const;

function addDays(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid attempt timestamp: ${isoTimestamp}`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function computeReviewState(
  currentGreenCount: number,
  outcome: Outcome,
  attemptedAt: string,
): ReviewState {
  if (!Number.isInteger(currentGreenCount) || currentGreenCount < 0) {
    throw new Error('currentGreenCount must be a non-negative integer.');
  }

  if (outcome === 'Red') {
    return {
      mastery: 'Red',
      greenCount: 0,
      nextReview: addDays(attemptedAt, 1),
    };
  }

  if (outcome === 'Yellow') {
    return {
      mastery: 'Yellow',
      greenCount: 0,
      nextReview: addDays(attemptedAt, 2),
    };
  }

  const greenCount = currentGreenCount + 1;
  if (greenCount >= 3) {
    return {
      mastery: 'Mastered',
      greenCount,
      nextReview: null,
    };
  }

  const delay = GREEN_REVIEW_DAYS[greenCount - 1] ?? GREEN_REVIEW_DAYS[1];
  return {
    mastery: 'Green',
    greenCount,
    nextReview: addDays(attemptedAt, delay),
  };
}

export function masteryRank(mastery: Mastery): number {
  const ranks: Record<Mastery, number> = {
    Unseen: 0,
    Red: 1,
    Yellow: 2,
    Green: 3,
    Mastered: 4,
  };
  return ranks[mastery];
}
