import type { CaptureEvent, CaptureResult, ProblemStatus } from '../shared/contract.js';
import { problemExternalKey } from '../shared/keys.js';
import { computeReviewState } from '../shared/review.js';
import type { CaptureRepository, StoredAttempt } from './repository.js';

function timestampValue(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(`Invalid stored attempt timestamp: ${value}`);
  return timestamp;
}

export class CaptureService {
  private readonly inFlight = new Map<string, Promise<CaptureResult>>();
  private readonly problemQueues = new Map<string, Promise<void>>();

  constructor(private readonly repository: CaptureRepository) {}

  capture(event: CaptureEvent): Promise<CaptureResult> {
    const current = this.inFlight.get(event.clientEventId);
    if (current) return current;

    const operation = this.captureOnce(event).finally(() => {
      this.inFlight.delete(event.clientEventId);
    });
    this.inFlight.set(event.clientEventId, operation);
    return operation;
  }

  async getProblemStatus(slug: string): Promise<ProblemStatus> {
    const problem = await this.repository.findProblemByExternalKey(problemExternalKey(slug));
    if (!problem) return { found: false };
    return {
      found: true,
      practiceState: problem.practiceState,
      solvedStreak: problem.solvedStreak,
      nextReview: problem.nextReview,
      lastAttempt: problem.lastAttempt,
    };
  }

  private async captureOnce(event: CaptureEvent): Promise<CaptureResult> {
    const existingAttempt = await this.repository.findAttemptByEventId(event.clientEventId);
    if (existingAttempt) {
      return this.withProblemLock(existingAttempt.problemKey, () =>
        this.repairDuplicate(existingAttempt),
      );
    }

    const externalKey = problemExternalKey(event.problem.slug);
    return this.withProblemLock(externalKey, async () => {
      const attemptCreatedWhileWaiting = await this.repository.findAttemptByEventId(
        event.clientEventId,
      );
      if (attemptCreatedWhileWaiting) {
        return this.repairDuplicate(attemptCreatedWhileWaiting);
      }

      let problem = await this.repository.findProblemByExternalKey(externalKey);
      if (problem) {
        await this.repository.updateProblemMetadata(problem.pageId, event);
      } else {
        problem = await this.repository.createProblem(event, externalKey);
      }

      const olderThanCanonical =
        problem.lastAttempt !== null &&
        timestampValue(event.attempt.attemptedAt) < timestampValue(problem.lastAttempt);
      const review = olderThanCanonical
        ? {
            practiceState: problem.practiceState,
            solvedStreak: problem.solvedStreak,
            nextReview: problem.nextReview,
          }
        : computeReviewState(problem.solvedStreak, event.attempt.result, event.attempt.attemptedOn);
      const attempt = await this.repository.createAttempt(problem, event, externalKey, review);
      if (
        problem.firstAttempt === null ||
        timestampValue(event.attempt.attemptedAt) < timestampValue(problem.firstAttempt)
      ) {
        await this.repository.applyFirstAttempt(problem.pageId, event.attempt.attemptedAt);
      }
      if (!olderThanCanonical) {
        await this.repository.applyReview(problem.pageId, event.attempt.attemptedAt, review);
      }

      return {
        duplicate: false,
        problemPageId: problem.pageId,
        attemptPageId: attempt.pageId,
        review,
      };
    });
  }

  private async repairDuplicate(existingAttempt: StoredAttempt): Promise<CaptureResult> {
    const problem = await this.repository.findProblemByPageId(existingAttempt.problemPageId);
    if (!problem) {
      throw new Error(`Attempt ${existingAttempt.pageId} references a missing Problem.`);
    }
    if (
      problem.firstAttempt === null ||
      timestampValue(existingAttempt.attemptedAt) < timestampValue(problem.firstAttempt)
    ) {
      await this.repository.applyFirstAttempt(
        existingAttempt.problemPageId,
        existingAttempt.attemptedAt,
      );
    }
    if (
      problem.lastAttempt === null ||
      timestampValue(existingAttempt.attemptedAt) >= timestampValue(problem.lastAttempt)
    ) {
      await this.repository.applyReview(
        existingAttempt.problemPageId,
        existingAttempt.attemptedAt,
        existingAttempt.review,
      );
    }
    return {
      duplicate: true,
      problemPageId: existingAttempt.problemPageId,
      attemptPageId: existingAttempt.pageId,
      review: existingAttempt.review,
    };
  }

  private async withProblemLock<T>(problemKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.problemQueues.get(problemKey) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => turn);
    this.problemQueues.set(problemKey, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.problemQueues.get(problemKey) === tail) {
        this.problemQueues.delete(problemKey);
      }
    }
  }
}
