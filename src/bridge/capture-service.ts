import type { CaptureEvent, CaptureResult } from '../shared/contract.js';
import { problemExternalKey } from '../shared/keys.js';
import { computeReviewState } from '../shared/review.js';
import type { CaptureRepository } from './repository.js';

export class CaptureService {
  private readonly inFlight = new Map<string, Promise<CaptureResult>>();

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

  private async captureOnce(event: CaptureEvent): Promise<CaptureResult> {
    const existingAttempt = await this.repository.findAttemptByEventId(event.clientEventId);
    if (existingAttempt) {
      await this.repository.applyReview(
        existingAttempt.problemPageId,
        existingAttempt.attemptedAt,
        existingAttempt.review,
      );
      return {
        duplicate: true,
        problemPageId: existingAttempt.problemPageId,
        attemptPageId: existingAttempt.pageId,
        review: existingAttempt.review,
      };
    }

    const externalKey = problemExternalKey(event.problem.slug);
    const problem =
      (await this.repository.findProblemByExternalKey(externalKey)) ??
      (await this.repository.createProblem(event, externalKey));

    const review = computeReviewState(
      problem.greenCount,
      event.attempt.outcome,
      event.attempt.attemptedAt,
    );
    const attempt = await this.repository.createAttempt(problem, event, externalKey, review);
    await this.repository.applyReview(problem.pageId, event.attempt.attemptedAt, review);

    return {
      duplicate: false,
      problemPageId: problem.pageId,
      attemptPageId: attempt.pageId,
      review,
    };
  }
}
