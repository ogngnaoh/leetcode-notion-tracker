import type { CaptureEvent, Difficulty, PracticeState, ReviewState } from '../shared/contract.js';

export interface ProblemRecord {
  pageId: string;
  externalKey: string;
  slug: string;
  title: string;
  number: number | null;
  url: string;
  difficulty: Difficulty;
  topics: string[];
  practiceState: PracticeState;
  solvedStreak: number;
  nextReview: string | null;
  lastAttempt: string | null;
}

export interface StoredAttempt {
  pageId: string;
  problemPageId: string;
  problemKey: string;
  attemptedAt: string;
  review: ReviewState;
}

export interface CaptureRepository {
  findAttemptByEventId(clientEventId: string): Promise<StoredAttempt | null>;
  findProblemByExternalKey(externalKey: string): Promise<ProblemRecord | null>;
  findProblemByPageId(pageId: string): Promise<ProblemRecord | null>;
  createProblem(event: CaptureEvent, externalKey: string): Promise<ProblemRecord>;
  updateProblemMetadata(problemPageId: string, event: CaptureEvent): Promise<void>;
  createAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt>;
  applyReview(problemPageId: string, attemptedAt: string, review: ReviewState): Promise<void>;
}
