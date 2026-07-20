import type { AttemptResult, CaptureResult } from '../../src/shared/contract.js';

const SESSION_KEY_PREFIX = 'leetcodeTracker.capture.tab.';
const RESULTS = new Set<AttemptResult>(['Couldn’t solve', 'Needed help', 'Solved']);

export interface PendingCaptureRecord {
  version: 1;
  clientEventId: string;
  result: AttemptResult;
  fingerprint: string;
  body: string;
}

export interface LastSuccessCaptureRecord {
  version: 2;
  fingerprint: string;
  result: AttemptResult;
  duplicate: boolean;
  review: CaptureResult['review'];
}

export interface CaptureSessionState {
  pending: PendingCaptureRecord | null;
  lastSuccess: LastSuccessCaptureRecord | null;
}

export interface CaptureSessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResult(value: unknown): value is AttemptResult {
  return typeof value === 'string' && RESULTS.has(value as AttemptResult);
}

function isPending(value: unknown): value is PendingCaptureRecord {
  if (!isRecord(value)) return false;
  if (!(
    value.version === 1 &&
    typeof value.clientEventId === 'string' &&
    value.clientEventId.length > 0 &&
    isResult(value.result) &&
    typeof value.fingerprint === 'string' &&
    value.fingerprint.length > 0 &&
    typeof value.body === 'string' &&
    value.body.length > 0 &&
    value.body.length <= 65_536
  )) {
    return false;
  }
  try {
    const event: unknown = JSON.parse(value.body);
    return (
      isRecord(event) &&
      event.clientEventId === value.clientEventId &&
      isRecord(event.attempt) &&
      event.attempt.result === value.result
    );
  } catch {
    return false;
  }
}

function isReview(value: unknown): value is CaptureResult['review'] {
  if (!isRecord(value)) return false;
  return (
    typeof value.practiceState === 'string' &&
    ['New', 'Couldn’t solve', 'Needed help', 'Solved', 'Mastered'].includes(value.practiceState) &&
    typeof value.solvedStreak === 'number' &&
    Number.isInteger(value.solvedStreak) &&
    value.solvedStreak >= 0 &&
    value.solvedStreak <= 5 &&
    (value.nextReview === null ||
      (typeof value.nextReview === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.nextReview)))
  );
}

function isSuccessPresentation(value: unknown, version: 1 | 2): boolean {
  if (!isRecord(value)) return false;
  return (
    value.version === version &&
    typeof value.fingerprint === 'string' &&
    value.fingerprint.length > 0 &&
    isResult(value.result) &&
    typeof value.duplicate === 'boolean' &&
    isReview(value.review)
  );
}

function readLastSuccess(stored: Record<string, unknown>): LastSuccessCaptureRecord | null {
  const current = stored.lastSuccess;
  if (isSuccessPresentation(current, 2)) {
    return current as unknown as LastSuccessCaptureRecord;
  }
  const legacy = stored.success;
  if (!isSuccessPresentation(legacy, 1)) return null;
  return { ...(legacy as Omit<LastSuccessCaptureRecord, 'version'>), version: 2 };
}

export class CaptureSessionStore {
  private readonly key: string;

  constructor(
    private readonly storage: CaptureSessionStorageArea,
    tabId: number,
  ) {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('A valid tab ID is required.');
    this.key = `${SESSION_KEY_PREFIX}${tabId}`;
  }

  async read(): Promise<CaptureSessionState> {
    const values = await this.storage.get(this.key);
    const stored = values[this.key];
    if (!isRecord(stored)) return { pending: null, lastSuccess: null };
    return {
      pending: isPending(stored.pending) ? stored.pending : null,
      lastSuccess: readLastSuccess(stored),
    };
  }

  async write(state: CaptureSessionState): Promise<void> {
    if (state.pending === null && state.lastSuccess === null) {
      await this.storage.remove(this.key);
      return;
    }
    await this.storage.set({ [this.key]: state });
  }
}
