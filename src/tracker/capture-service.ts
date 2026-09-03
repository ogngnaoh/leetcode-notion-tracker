import type { CaptureEvent, CaptureResult, ProblemStatus } from '../shared/contract.js';
import { problemExternalKey } from '../shared/keys.js';
import { computeReviewState } from '../shared/review.js';
import { matchesNotionTimestamp } from './notion-timestamps.js';
import type {
  CaptureRepository,
  ProblemRecord,
  ProblemUpdate,
  StoredAttempt,
} from './repository.js';

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
    // A recorded UUID wins over incoming retry metadata, including an invalid slug.
    const externalKey = existingAttempt?.problemKey ?? problemExternalKey(event.problem.slug);
    return this.withProblemLock(externalKey, async () => {
      const repository = this.repository.captureSession(existingAttempt);
      const reconciled = await this.reconcileLatest(repository, externalKey);
      const attemptCreatedWhileWaiting = await repository.findAttemptByEventId(
        event.clientEventId,
        externalKey,
      );
      if (attemptCreatedWhileWaiting) {
        const result = await this.repairDuplicate(repository, attemptCreatedWhileWaiting);
        await repository.completeCapture();
        return result;
      }
      if (existingAttempt) throw new Error('Previously recorded capture receipt is missing.');

      let problem = reconciled ?? (await repository.findProblemByExternalKey(externalKey));
      const update: ProblemUpdate = problem ? { event } : {};
      if (!problem) problem = await repository.createProblem(event, externalKey);

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
      const attempt = await repository.createAttempt(problem, event, externalKey, review);
      if (
        problem.firstAttempt === null ||
        timestampValue(event.attempt.attemptedAt) < timestampValue(problem.firstAttempt)
      ) {
        update.firstAttempt = event.attempt.attemptedAt;
      }
      if (!olderThanCanonical) {
        update.review = { attemptedAt: event.attempt.attemptedAt, state: review };
      }
      await repository.updateProblem(problem.pageId, update);
      await repository.completeCapture();

      return {
        duplicate: false,
        problemPageId: problem.pageId,
        attemptPageId: attempt.pageId,
        review,
      };
    });
  }

  private async reconcileLatest(
    repository: CaptureRepository,
    problemKey: string,
  ): Promise<ProblemRecord | null> {
    const latest = await repository.findLatestAttemptByProblemKey(problemKey);
    if (!latest) return null;
    const problem = await repository.findProblemByPageId(latest.problemPageId);
    if (!problem) throw new Error('Latest Attempt references a missing Problem.');
    const first = latest.firstAttempt ?? latest.attemptedAt;
    const sameLastAttempt = matchesNotionTimestamp(problem.lastAttempt, latest.attemptedAt);
    const update: ProblemUpdate = latest.pendingEvent ? { event: latest.pendingEvent } : {};
    if (
      problem.firstAttempt === null ||
      timestampValue(first) < timestampValue(problem.firstAttempt)
    ) {
      update.firstAttempt = first;
    }
    if (
      problem.lastAttempt === null ||
      (!sameLastAttempt &&
        timestampValue(latest.attemptedAt) > timestampValue(problem.lastAttempt)) ||
      (sameLastAttempt &&
        (problem.practiceState !== latest.review.practiceState ||
          problem.solvedStreak !== latest.review.solvedStreak ||
          problem.nextReview !== latest.review.nextReview))
    ) {
      update.review = { attemptedAt: latest.attemptedAt, state: latest.review };
    }
    await repository.updateProblem(problem.pageId, update);
    // Recovery is durable before calculating the next event's streak.
    await repository.completeCapture();
    return {
      ...problem,
      // Use the receipt's exact time for ordering subsequent captures within
      // the same minute, while leaving the native Notion date untouched.
      ...(sameLastAttempt ? { lastAttempt: latest.attemptedAt } : {}),
      ...(update.event
        ? { ...update.event.problem, number: update.event.problem.number ?? null }
        : {}),
      ...(update.firstAttempt ? { firstAttempt: update.firstAttempt } : {}),
      ...(update.review ? { ...update.review.state, lastAttempt: update.review.attemptedAt } : {}),
    };
  }

  private async repairDuplicate(
    repository: CaptureRepository,
    existingAttempt: StoredAttempt,
  ): Promise<CaptureResult> {
    const problem = await repository.findProblemByPageId(existingAttempt.problemPageId);
    if (!problem) {
      throw new Error(`Attempt ${existingAttempt.pageId} references a missing Problem.`);
    }
    const update: ProblemUpdate = {};
    const sameLastAttempt = matchesNotionTimestamp(
      problem.lastAttempt,
      existingAttempt.attemptedAt,
    );
    if (
      problem.firstAttempt === null ||
      timestampValue(existingAttempt.attemptedAt) < timestampValue(problem.firstAttempt)
    ) {
      update.firstAttempt = existingAttempt.attemptedAt;
    }
    if (
      !existingAttempt.superseded &&
      (problem.lastAttempt === null ||
        (!sameLastAttempt &&
          timestampValue(existingAttempt.attemptedAt) > timestampValue(problem.lastAttempt)) ||
        (sameLastAttempt &&
          (problem.practiceState !== existingAttempt.review.practiceState ||
            problem.solvedStreak !== existingAttempt.review.solvedStreak ||
            problem.nextReview !== existingAttempt.review.nextReview)))
    ) {
      update.review = { attemptedAt: existingAttempt.attemptedAt, state: existingAttempt.review };
    }
    await repository.updateProblem(existingAttempt.problemPageId, update);
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
