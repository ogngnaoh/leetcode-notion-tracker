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
  firstAttempt: string | null;
}

export interface StoredAttempt {
  pageId: string;
  problemPageId: string;
  problemKey: string;
  attemptedAt: string;
  result: CaptureEvent['attempt']['result'];
  review: ReviewState;
  superseded?: boolean;
  firstAttempt?: string;
  pendingEvent?: CaptureEvent;
}

export interface ProblemUpdate {
  event?: CaptureEvent;
  firstAttempt?: string;
  review?: { attemptedAt: string; state: ReviewState };
}

export interface CaptureRepository {
  // Called only after acquiring the Problem lock. State must not escape this capture.
  captureSession(existing: StoredAttempt | null): CaptureRepository;
  completeCapture(): Promise<void>;
  updateProblem(problemPageId: string, update: ProblemUpdate): Promise<void>;
  findAttemptByEventId(clientEventId: string, problemKey?: string): Promise<StoredAttempt | null>;
  findLatestAttemptByProblemKey(problemKey: string): Promise<StoredAttempt | null>;
  findProblemByExternalKey(externalKey: string): Promise<ProblemRecord | null>;
  findProblemByPageId(pageId: string): Promise<ProblemRecord | null>;
  createProblem(event: CaptureEvent, externalKey: string): Promise<ProblemRecord>;
  createAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt>;
}
