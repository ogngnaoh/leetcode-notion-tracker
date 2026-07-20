import type { CaptureEvent, ReviewState } from '../shared/contract.js';

export interface ProblemRecord {
  pageId: string;
  externalKey: string;
  greenCount: number;
}

export interface StoredAttempt {
  pageId: string;
  problemPageId: string;
  attemptedAt: string;
  review: ReviewState;
}

export interface CaptureRepository {
  findAttemptByEventId(clientEventId: string): Promise<StoredAttempt | null>;
  findProblemByExternalKey(externalKey: string): Promise<ProblemRecord | null>;
  createProblem(event: CaptureEvent, externalKey: string): Promise<ProblemRecord>;
  createAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt>;
  applyReview(problemPageId: string, attemptedAt: string, review: ReviewState): Promise<void>;
}
