import type { CaptureEvent, ReviewState } from '../shared/contract.js';
import type {
  CaptureRepository,
  ProblemRecord,
  ProblemUpdate,
  StoredAttempt,
} from './repository.js';

export class MemoryCaptureRepository implements CaptureRepository {
  captureSession(): CaptureRepository {
    return this;
  }
  async completeCapture(): Promise<void> {}
  async updateProblem(pageId: string, update: ProblemUpdate): Promise<void> {
    if (update.event) await this.updateProblemMetadata(pageId, update.event);
    if (update.firstAttempt) await this.applyFirstAttempt(pageId, update.firstAttempt);
    if (update.review)
      await this.applyReview(pageId, update.review.attemptedAt, update.review.state);
  }
  readonly attempts = new Map<string, StoredAttempt>();
  readonly latestAttempts = new Map<string, StoredAttempt>();
  readonly problems = new Map<string, ProblemRecord>();
  readonly operations: string[] = [];
  readonly metadataUpdates: Array<{ problemPageId: string; event: CaptureEvent }> = [];
  readonly appliedReviews: Array<{
    problemPageId: string;
    attemptedAt: string;
    review: ReviewState;
  }> = [];

  async findAttemptByEventId(clientEventId: string): Promise<StoredAttempt | null> {
    const receipt = this.attempts.get(clientEventId);
    if (!receipt) return null;
    return { ...receipt, superseded: this.latestAttempts.get(receipt.problemKey) !== receipt };
  }

  async findLatestAttemptByProblemKey(problemKey: string): Promise<StoredAttempt | null> {
    const latest = this.latestAttempts.get(problemKey);
    if (!latest) return null;
    const firstAttempt = [...this.attempts.values()]
      .filter((attempt) => attempt.problemKey === problemKey)
      .sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt))[0]!.attemptedAt;
    return { ...latest, firstAttempt };
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
      pageId:
        this.latestAttempts.get(externalKey)?.pageId ?? `attempt-${this.latestAttempts.size + 1}`,
      problemPageId: problem.pageId,
      problemKey: externalKey,
      attemptedAt: event.attempt.attemptedAt,
      result: event.attempt.result,
      review,
    };
    this.attempts.set(event.clientEventId, record);
    const previous = this.latestAttempts.get(externalKey);
    if (!previous || Date.parse(record.attemptedAt) >= Date.parse(previous.attemptedAt)) {
      this.latestAttempts.set(externalKey, record);
    }
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
