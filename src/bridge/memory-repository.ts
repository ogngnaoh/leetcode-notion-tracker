import type { CaptureEvent, ReviewState } from '../shared/contract.js';
import type { CaptureRepository, ProblemRecord, StoredAttempt } from './repository.js';

export class MemoryCaptureRepository implements CaptureRepository {
  readonly attempts = new Map<string, StoredAttempt>();
  readonly problems = new Map<string, ProblemRecord>();
  readonly appliedReviews: Array<{
    problemPageId: string;
    attemptedAt: string;
    review: ReviewState;
  }> = [];

  async findAttemptByEventId(clientEventId: string): Promise<StoredAttempt | null> {
    return this.attempts.get(clientEventId) ?? null;
  }

  async findProblemByExternalKey(externalKey: string): Promise<ProblemRecord | null> {
    return this.problems.get(externalKey) ?? null;
  }

  async createProblem(_event: CaptureEvent, externalKey: string): Promise<ProblemRecord> {
    const record: ProblemRecord = {
      pageId: `problem-${this.problems.size + 1}`,
      externalKey,
      greenCount: 0,
    };
    this.problems.set(externalKey, record);
    return record;
  }

  async createAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    _externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt> {
    const record: StoredAttempt = {
      pageId: `attempt-${this.attempts.size + 1}`,
      problemPageId: problem.pageId,
      attemptedAt: event.attempt.attemptedAt,
      review,
    };
    this.attempts.set(event.clientEventId, record);
    return record;
  }

  async applyReview(
    problemPageId: string,
    attemptedAt: string,
    review: ReviewState,
  ): Promise<void> {
    this.appliedReviews.push({ problemPageId, attemptedAt, review });
    for (const [key, problem] of this.problems.entries()) {
      if (problem.pageId === problemPageId) {
        this.problems.set(key, { ...problem, greenCount: review.greenCount });
        break;
      }
    }
  }
}
