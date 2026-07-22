import type { CaptureEvent, ReviewState } from '../shared/contract.js';
import type { CaptureRepository, ProblemRecord, StoredAttempt } from './repository.js';

export class MemoryCaptureRepository implements CaptureRepository {
  readonly attempts = new Map<string, StoredAttempt>();
  readonly problems = new Map<string, ProblemRecord>();
  readonly operations: string[] = [];
  readonly metadataUpdates: Array<{ problemPageId: string; event: CaptureEvent }> = [];
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

  async findProblemByPageId(pageId: string): Promise<ProblemRecord | null> {
    return [...this.problems.values()].find((problem) => problem.pageId === pageId) ?? null;
  }

  async createProblem(event: CaptureEvent, externalKey: string): Promise<ProblemRecord> {
    this.operations.push('createProblem');
    const record: ProblemRecord = {
      pageId: `problem-${this.problems.size + 1}`,
      externalKey,
      ...event.problem,
      number: event.problem.number ?? null,
      topics: [...event.problem.topics],
      practiceState: 'New',
      solvedStreak: 0,
      nextReview: null,
      lastAttempt: null,
      firstAttempt: null,
    };
    this.problems.set(externalKey, record);
    return record;
  }

  async updateProblemMetadata(problemPageId: string, event: CaptureEvent): Promise<void> {
    this.operations.push('updateProblemMetadata');
    this.metadataUpdates.push({ problemPageId, event });
    for (const [key, problem] of this.problems.entries()) {
      if (problem.pageId === problemPageId) {
        this.problems.set(key, {
          ...problem,
          ...event.problem,
          number: event.problem.number ?? null,
          topics: [...event.problem.topics],
        });
        return;
      }
    }
    throw new Error(`Unknown Problem page: ${problemPageId}`);
  }

  async createAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt> {
    this.operations.push('createAttempt');
    const record: StoredAttempt = {
      pageId: `attempt-${this.attempts.size + 1}`,
      problemPageId: problem.pageId,
      problemKey: externalKey,
      attemptedAt: event.attempt.attemptedAt,
      result: event.attempt.result,
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
    this.operations.push('applyReview');
    this.appliedReviews.push({ problemPageId, attemptedAt, review });
    for (const [key, problem] of this.problems.entries()) {
      if (problem.pageId === problemPageId) {
        this.problems.set(key, {
          ...problem,
          practiceState: review.practiceState,
          solvedStreak: review.solvedStreak,
          nextReview: review.nextReview,
          lastAttempt: attemptedAt,
        });
        return;
      }
    }
    throw new Error(`Unknown Problem page: ${problemPageId}`);
  }

  async applyFirstAttempt(problemPageId: string, attemptedAt: string): Promise<void> {
    this.operations.push('applyFirstAttempt');
    for (const [key, problem] of this.problems.entries()) {
      if (problem.pageId === problemPageId) {
        this.problems.set(key, { ...problem, firstAttempt: attemptedAt });
        return;
      }
    }
    throw new Error(`Unknown Problem page: ${problemPageId}`);
  }
}
