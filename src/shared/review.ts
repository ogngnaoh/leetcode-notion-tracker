import type { AttemptResult, ReviewState } from './contract.js';

const SOLVED_REVIEW_DAYS = [1, 3, 7, 14] as const;

function calendarParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
    ? parts
    : null;
}

function addCalendarDays(calendarDate: string, days: number): string {
  const parts = calendarParts(calendarDate);
  if (!parts) throw new Error('attemptedOn must be a valid YYYY-MM-DD calendar date.');
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

export function computeReviewState(
  currentSolvedStreak: number,
  result: AttemptResult,
  attemptedOn: string,
): ReviewState {
  if (
    !Number.isInteger(currentSolvedStreak) ||
    currentSolvedStreak < 0 ||
    currentSolvedStreak > 5
  ) {
    throw new Error('currentSolvedStreak must be an integer from 0 through 5.');
  }
  if (!calendarParts(attemptedOn)) {
    throw new Error('attemptedOn must be a valid YYYY-MM-DD calendar date.');
  }
  if (result !== 'Needed help' && result !== 'Solved') {
    throw new Error('result must be Needed help or Solved.');
  }
  if (result === 'Needed help') {
    return { practiceState: result, solvedStreak: 0, nextReview: attemptedOn };
  }

  const solvedStreak = Math.min(currentSolvedStreak + 1, 5);
  if (solvedStreak === 5) {
    return { practiceState: 'Mastered', solvedStreak, nextReview: null };
  }
  return {
    practiceState: 'Solved',
    solvedStreak,
    nextReview: addCalendarDays(attemptedOn, SOLVED_REVIEW_DAYS[solvedStreak - 1]!),
  };
}
